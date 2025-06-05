 // Função para abrir o modal de agendamento com os dados da aula
 function abrirModalAgendamento(descricao, preco) {
  // Atualizar informações da aula no modal
  document.getElementById('reserva-titulo').textContent = descricao;
  document.getElementById('reserva-preco').textContent = `Preço: €${preco}`;
  
  // Exibir o modal
  document.getElementById('modal-agendamento').style.display = 'flex';
}

// Função para fechar o modal de agendamento
function fecharModalAgendamento() {
  document.getElementById('modal-agendamento').style.display = 'none';
  document.getElementById('mensagem-agendamento').style.display = 'none';
  document.getElementById('form-agendamento').reset();
}

document.addEventListener('DOMContentLoaded', function() {
  // Adiciona evento aos botões de reservar
  const reservarBtns = document.querySelectorAll('.reservar-btn');
  reservarBtns.forEach(btn => {
      btn.addEventListener('click', function() {
          // Obter dados da aula
          const descricao = this.dataset.descricao;
          const preco = this.dataset.preco;
          
          // Abrir modal com os dados
          abrirModalAgendamento(descricao, preco);
      });
  });

  // Fecha o modal ao clicar no X
  document.getElementById('fechar-modal').onclick = fecharModalAgendamento;

  // Fecha o modal ao clicar fora do conteúdo
  window.onclick = function(event) {
      const modal = document.getElementById('modal-agendamento');
      if (event.target === modal) {
          fecharModalAgendamento();
      }
  };

  // Lógica do formulário de agendamento
  document.getElementById('form-agendamento').onsubmit = function(e) {
      e.preventDefault();
      
      // Simulação de processamento do agendamento
      document.getElementById('mensagem-agendamento').innerText = 'Agendamento realizado com sucesso!';
      document.getElementById('mensagem-agendamento').style.display = 'block';
      
      // Fechar o modal após 3 segundos
      setTimeout(function() {
          fecharModalAgendamento();
          
          // Redefinir a mensagem após mais 1 segundo
          setTimeout(function() {
              document.getElementById('mensagem-agendamento').style.display = 'none';
          }, 1000);
      }, 3000);
  };
  
  // Configurar data mínima para hoje
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, '0');
  const mm = String(hoje.getMonth() + 1).padStart(2, '0'); // Janeiro é 0!
  const yyyy = hoje.getFullYear();
  
  const dataMinima = yyyy + '-' + mm + '-' + dd;
  document.getElementById('data').min = dataMinima;
});