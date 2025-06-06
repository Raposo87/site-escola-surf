const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3001;

// Configuração do CORS e JSON
app.use(cors());
app.use(express.json());

// Conexão com o banco de dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Rota de teste
app.get('/', (req, res) => {
  res.send('API de agendamento funcionando!');
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

// Rota para criar um novo agendamento
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

  // Rota de pagamentos
  app.post('/criar-sessao-pagamento', async (req, res) => {
    const { nome, email, data_agendamento, horario, preco } = req.body;
  
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: {
              name: nome,
            },
            unit_amount: preco * 100,
          },
          quantity: 1,
        }],
        mode: 'payment',
        customer_email: email,
        success_url: 'https://SEU_FRONTEND_URL/sucesso.html',
        cancel_url: 'https://SEU_FRONTEND_URL/cancelado.html',
        metadata: {
          nome,
          email,
          data_agendamento,
          horario
        }
      });
  
      res.json({ url: session.url });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar sessão de pagamento' });
    }
  });

app.post('/webhook-stripe', express.raw({type: 'application/json'}), (req, res) => {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // Pegue no painel da Stripe
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.sendStatus(400);
  }

  // Quando o pagamento for aprovado
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { nome, email, data_agendamento, horario } = session.metadata;

    // Salve o agendamento no banco aqui!
    pool.query(
      'INSERT INTO agendamentos (nome, email, data_agendamento, horario) VALUES ($1, $2, $3, $4)',
      [nome, email, data_agendamento, horario]
    ).then(() => {
      console.log('Agendamento salvo após pagamento!');
    }).catch(err => {
      console.error('Erro ao salvar agendamento:', err);
    });
  }

  res.json({received: true});
});