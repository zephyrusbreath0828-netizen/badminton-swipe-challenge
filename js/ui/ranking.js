/**
 * ランキング描画
 */
export function renderRanking(listEl, ranking) {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!ranking || ranking.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ranking__empty';
    empty.textContent = 'まだ記録がありません。プレイして1位を目指そう！';
    listEl.appendChild(empty);
    return;
  }
  ranking.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    if (i === 0) row.classList.add('is-first');

    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
    const d = new Date(entry.date || Date.now());
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;

    row.innerHTML = `
      <span class="rank-row__medal">${medal}</span>
      <span class="rank-row__score">${entry.score.toLocaleString('ja-JP')}<small>pt</small></span>
      <span class="rank-row__meta">
        <span>ラリー ${entry.rally}</span>
        <span>SMASH ${entry.smashes}</span>
        <span>Lv.${entry.level}</span>
      </span>
      <span class="rank-row__date">${dateStr}</span>
    `;
    listEl.appendChild(row);
  });
}
