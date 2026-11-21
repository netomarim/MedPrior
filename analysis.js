window.MedPriorAnalysis = (() => {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  function parse(value) {
    try {
      const data = JSON.parse(value);
      if (data?.version === 3 && (data.phase !== 'complete' || !Array.isArray(data.recordedAnswers) || data.recordedAnswers.some(answer => !answer || typeof answer.question !== 'string' || typeof answer.answer !== 'string'))) return null;
      return [2,3].includes(data?.version) && ['facts','gaps','questions'].every(key => Array.isArray(data[key]) && data[key].every(item => typeof item === 'string')) && typeof data.note === 'string' ? data : null;
    } catch { return null; }
  }
  function render(value) {
    if (!value) return '<p>Gere uma ficha para identificar informações faltantes e perguntas que ajudem a complementar o relato.</p>';
    const data = parse(value);
    if (data?.version === 3 && data.phase === 'complete' && Array.isArray(data.recordedAnswers)) {
      return `<p class="interview-complete">Rodada concluída. Ficha consolidada automaticamente com as respostas salvas, sem uma nova chamada à IA.</p><section class="analysis-section"><h3>Respostas incluídas na ficha</h3>${data.recordedAnswers.map(a => `<article class="answer-record"><strong>${escape(a.question)}</strong><p>${escape(a.answer)}</p></article>`).join('')}</section><p>${escape(data.note)}</p>`;
    }
    if (data?.version !== 2 || !['facts', 'gaps', 'questions'].every(key => Array.isArray(data[key]) && data[key].every(item => typeof item === 'string')) || typeof data.note !== 'string') {
      return `<p class="ai-legacy">Resumo anterior. Clique em “Atualizar ficha com IA” para obter a nova análise.</p><p>${escape(value)}</p>`;
    }
    const sections = [['facts', 'Informações identificadas'], ['gaps', 'Informações que faltam esclarecer'], ['questions', 'Perguntas para complementar']];
    return sections.map(([key, title]) => `<section class="analysis-section"><h3>${title}</h3><ul>${data[key].length ? data[key].map(item => `<li>${escape(item)}</li>`).join('') : '<li>Nenhum item indicado nesta ficha.</li>'}</ul></section>`).join('') +
      `<section class="analysis-note"><h3>Sobre este registro</h3><p>${escape(data.note)}</p></section>`;
  }
  const priorities = {not_assessed:'Não classificado', non_urgent:'Não urgente', low_urgency:'Pouco urgente', urgent:'Urgente', very_urgent:'Muito urgente', emergency:'Emergência'};
  return { render, parse, priorities };
})();
