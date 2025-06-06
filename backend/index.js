require('dotenv').config();
const express = require('express'); // ✅ ADICIONADO - estava faltando
const cors = require('cors');
const { Pool } = require('pg');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3001;

// Conexão com o banco de dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Configurar email
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// IMPORTANTE: Webhook ANTES do middleware express.json()
app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('🎯 Webhook recebido:', event.type);
  } catch (err) {
    console.log(`⚠️ Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Processar eventos
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('💰 Pagamento recebido:', session.id);
      console.log('📋 Session metadata:', session.metadata);
      
      const { nome, email, data_agendamento, horario } = session.metadata;

      try {
        // 1. Salvar o agendamento no banco
        const result = await pool.query(
          'INSERT INTO agendamentos (nome, email, data_agendamento, horario, valor_pago, stripe_session_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
          [nome, email, data_agendamento, horario, session.amount_total / 100, session.id, 'paid']
        );
        console.log('✅ Agendamento salvo após pagamento:', result.rows[0]);

        // 2. Enviar email de confirmação
        await enviarEmailConfirmacao(session);
        
      } catch (err) {
        console.error('❌ Erro ao processar pagamento:', err);
      }
      break;
      
    default:
      console.log(`Evento não tratado: ${event.type}`);
  }

  res.json({received: true});
});

// Configuração do CORS e JSON APÓS o webhook
app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => {
  res.send('API de agendamento funcionando!');
});

// Rota para criar um novo agendamento (caso queira testar diretamente)
app.post('/agendamentos', async (req, res) => {
  const { nome, email, data_agendamento, horario } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO agendamentos (nome, email, data_agendamento, horario) VALUES ($1, $2, $3, $4) RETURNING *',
      [nome, email, data_agendamento, horario]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar agendamento:', error);
    res.status(500).json({ error: 'Erro ao criar agendamento' });
  }
});

// Rota para listar todos os agendamentos
app.get('/agendamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agendamentos ORDER BY data_agendamento, horario');
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar agendamentos:', error);
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

// Rota de pagamentos - CORRIGIDA
app.post('/criar-sessao-pagamento', async (req, res) => {
  const { nome, email, data_agendamento, horario, preco, descricao } = req.body;

  console.log('Dados recebidos:', { nome, email, data_agendamento, horario, preco, descricao });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: descricao || 'Aula de Surf - Surf Wave Lisboa',
            description: `Aula agendada para ${data_agendamento} às ${horario}`,
          },
          unit_amount: Math.round(preco * 100), // Garantir que seja inteiro
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email,
      // URLs dinâmicas baseadas no ambiente
      success_url: process.env.FRONTEND_URL 
        ? `${process.env.FRONTEND_URL}/sucesso.html?session_id={CHECKOUT_SESSION_ID}`
        : `${req.protocol}://${req.get('host')}/sucesso.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: process.env.FRONTEND_URL 
        ? `${process.env.FRONTEND_URL}/erro.html`
        : `${req.protocol}://${req.get('host')}/erro.html`,
      metadata: {
        nome,
        email,
        data_agendamento,
        horario,
        descricao: descricao || 'Aula de Surf'
      }
    });

    console.log('Sessão criada com sucesso:', session.id);
    res.json({ url: session.url });
  } catch (error) {
    console.error('Erro ao criar sessão:', error);
    res.status(500).json({ error: 'Erro ao criar sessão de pagamento' });
  }
});

// Rota para verificar status de pagamento
app.get('/verificar-pagamento/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    res.json({
      status: session.payment_status,
      customer_email: session.customer_email,
      metadata: session.metadata
    });
  } catch (error) {
    console.error('Erro ao verificar pagamento:', error);
    res.status(500).json({ error: 'Erro ao verificar pagamento' });
  }
});

// Função para enviar email
async function enviarEmailConfirmacao(session) {
  try {
    const { nome, email, data_agendamento, horario } = session.metadata;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: session.customer_email, // Use customer_email em vez de customer_details.email
      subject: '🏄‍♂️ Confirmação de Agendamento - Surf Wave Lisboa',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0066cc;">Agendamento Confirmado! 🌊</h2>
          <p>Olá <strong>${nome}</strong>!</p>
          <p>Seu agendamento para aula de surf foi confirmado com sucesso!</p>
          
          <div style="background: #f0f8ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Detalhes do Agendamento:</h3>
            <p><strong>Data:</strong> ${data_agendamento}</p>
            <p><strong>Horário:</strong> ${horario}</p>
            <p><strong>Valor Pago:</strong> €${(session.amount_total / 100).toFixed(2)}</p>
            <p><strong>ID do Pedido:</strong> ${session.id}</p>
          </div>
          
          <p>Estamos ansiosos para te ver nas ondas!</p>
          <p>Chegue 15 minutos antes do horário marcado.</p>
          
          <hr>
          <p style="font-size: 12px; color: #666;">
            Surf Wave Lisboa - Onde a paixão encontra as ondas
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ Email enviado para:', session.customer_email);
    
  } catch (error) {
    console.error('❌ Erro ao enviar email:', error);
  }
}

// Iniciar servidor
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`🌐 URL: https://site-escola-surf-production.up.railway.app`);
});