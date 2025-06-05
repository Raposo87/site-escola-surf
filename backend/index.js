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