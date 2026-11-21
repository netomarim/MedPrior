window.MedPriorAnalysis = (() => {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  function render(value) {
    if (!value) return '<p>Gere uma ficha para identificar informações faltantes e perguntas que ajudem a complementar o relato.</p>';
    let data;
    try { data = JSON.parse(value); } catch {}
    if (data?.version !== 2 || !['facts', 'gaps', 'questions'].every(key => Array.isArray(data[key]) && data[key].every(item => typeof item === 'string')) || typeof data.note !== 'string') {
      return `<p class="ai-legacy">Resumo anterior. Clique em “Atualizar ficha com IA” para obter a nova análise.</p><p>${escape(value)}</p>`;
    }
    const sections = [['facts', 'Informações identificadas'], ['gaps', 'Informações que faltam esclarecer'], ['questions', 'Perguntas para complementar']];
    return sections.map(([key, title]) => `<section class="analysis-section"><h3>${title}</h3><ul>${data[key].map(item => `<li>${escape(item)}</li>`).join('')}</ul></section>`).join('') +
      `<section class="analysis-note"><h3>Sobre este registro</h3><p>${escape(data.note)}</p></section>`;
  }
  return { render };
})();
