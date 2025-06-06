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

// Correção: createTransport (sem 'er' no final)
const transporter = nodemailer.createTransport({
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

// Middleware para adicionar headers CORS manualmente
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://raposo87.github.io',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:5500',
    'https://site-escola-surf-production.up.railway.app'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    console.log('🔄 Preflight request recebido de:', origin);
    return res.status(200).end();
  }
  
  next();
});

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

// ... restante do código permanece igual ...