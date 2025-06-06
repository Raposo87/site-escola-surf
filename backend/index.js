require('dotenv').config();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3001;

// Conexão com o banco de dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// IMPORTANTE: Webhook ANTES do middleware express.json()
app.post('/webhook-stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('Webhook recebido:', event.type);
  } catch (err) {
    console.log(`Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Quando o pagamento for aprovado
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Session metadata:', session.metadata);
    
    const { nome, email, data_agendamento, horario } = session.metadata;

    try {
      // Salve o agendamento no banco
      const result = await pool.query(
        'INSERT INTO agendamentos (nome, email, data_agendamento, horario, valor_pago, stripe_session_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [nome, email, data_agendamento, horario, session.amount_total / 100, session.id]
      );
      console.log('Agendamento salvo após pagamento:', result.rows[0]);
    } catch (err) {
      console.error('Erro ao salvar agendamento:', err);
    }
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

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
