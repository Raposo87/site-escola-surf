require('dotenv').config();
const express = require('express');
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

// CORS CORRIGIDO - Configuração simplificada e correta
const corsOptions = {
  origin: [
    'https://raposo87.github.io',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:5500'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true
};

app.use(cors(corsOptions));

// JSON middleware APÓS CORS
app.use(express.json());

// Middleware de logging para debug
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
  next();
});

// Rota de teste
app.get('/', (req, res) => {
  res.json({ 
    message: 'API de agendamento funcionando!',
    cors: 'Configurado para GitHub Pages',
    timestamp: new Date().toISOString()
  });
});

// Rota para criar sessão de pagamento
app.post('/criar-sessao-pagamento', async (req, res) => {
  try {
    console.log('📝 Dados recebidos:', req.body);
    
    const { nome, email, data_agendamento, horario, preco, descricao } = req.body;

    // Validação básica
    if (!nome || !email || !data_agendamento || !horario || !preco) {
      return res.status(400).json({ 
        error: 'Dados obrigatórios faltando',
        required: ['nome', 'email', 'data_agendamento', 'horario', 'preco']
      });
    }

    // Criar sessão do Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: descricao || 'Aula de Surf',
            description: `Aula agendada para ${data_agendamento} às ${horario}`,
          },
          unit_amount: Math.round(preco * 100), // Converter para centavos
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `https://raposo87.github.io/frontend-escola-surf/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://raposo87.github.io/frontend-escola-surf/?canceled=true`,
      metadata: {
        nome,
        email,
        data_agendamento,
        horario,
        preco: preco.toString()
      }
    });

    console.log('✅ Sessão criada:', session.id);
    res.json({ url: session.url });

  } catch (error) {
    console.error('❌ Erro ao criar sessão:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
});

// Rota para verificar pagamento
app.get('/verificar-pagamento/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    res.json({
      status: session.payment_status,
      customer_email: session.customer_details?.email,
      amount_total: session.amount_total / 100
    });
  } catch (error) {
    console.error('❌ Erro ao verificar pagamento:', error);
    res.status(500).json({ error: 'Erro ao verificar pagamento' });
  }
});

// Função para enviar email de confirmação
async function enviarEmailConfirmacao(session) {
  try {
    const { nome, email, data_agendamento, horario } = session.metadata;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: '✅ Confirmação de Agendamento - Surf Wave Lisboa',
      html: `
        <h2>Agendamento Confirmado!</h2>
        <p>Olá ${nome},</p>
        <p>Seu agendamento foi confirmado com sucesso:</p>
        <ul>
          <li><strong>Data:</strong> ${data_agendamento}</li>
          <li><strong>Horário:</strong> ${horario}</li>
          <li><strong>Valor pago:</strong> €${session.amount_total / 100}</li>
        </ul>
        <p>Nos vemos na praia! 🏄‍♀️</p>
        <p>Surf Wave Lisboa</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('📧 Email enviado para:', email);
  } catch (error) {
    console.error('❌ Erro ao enviar email:', error);
  }
}

// Rota para listar agendamentos (opcional para admin)
app.get('/agendamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agendamentos ORDER BY data_agendamento DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erro ao buscar agendamentos:', error);
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`🌐 CORS configurado para: ${corsOptions.origin.join(', ')}`);
});