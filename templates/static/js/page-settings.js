;(() => {
  if (!document.body.classList.contains('page-settings')) return;
document.addEventListener('DOMContentLoaded', () => {
  initHeaderSearch();
  initSettings();
});

function initSettings() {
  const settings = getSettings();

  const speedSelect           = document.getElementById('defaultSpeedSelect');
  const loopToggle            = document.getElementById('loopToggle');
  const autoplayNextToggle    = document.getElementById('autoplayNextToggle');
  const autoplayToggle        = document.getElementById('autoplayToggle');
  const savePositionToggle    = document.getElementById('savePositionToggle');
  const volumeSlider          = document.getElementById('defaultVolumeSlider');
  const volumeValue           = document.getElementById('defaultVolumeValue');
  const resetBtn              = document.getElementById('resetSettingsBtn');
  const clearHistBtn          = document.getElementById('clearHistBtn');
  const clearFavBtn           = document.getElementById('clearFavBtn');
  const toast                 = document.getElementById('savedToast');

  speedSelect.value            = String(settings.defaultSpeed);
  loopToggle.checked           = !!settings.loop;
  autoplayNextToggle.checked   = !!settings.autoplayNext;
  autoplayToggle.checked       = settings.autoplay !== false;
  savePositionToggle.checked   = !!settings.savePosition;
  volumeSlider.value           = String(settings.defaultVolume ?? 100);
  volumeValue.textContent      = `${settings.defaultVolume ?? 100}%`;

  function updateVolSliderFill() {
    const pct = ((volumeSlider.value - volumeSlider.min) / (volumeSlider.max - volumeSlider.min)) * 100;
    volumeSlider.style.setProperty('--fill', `${pct}%`);
  }
  updateVolSliderFill();

  let toastTimer = null;
  function showToast() {
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2000);
  }

  function persist() {
    saveSettings({
      defaultSpeed: parseFloat(speedSelect.value),
      loop: loopToggle.checked,
      autoplayNext: autoplayNextToggle.checked,
      autoplay: autoplayToggle.checked,
      savePosition: savePositionToggle.checked,
      defaultVolume: parseInt(volumeSlider.value, 10),
    });
    showToast();
  }

  volumeSlider.addEventListener('input', () => {
    volumeValue.textContent = `${volumeSlider.value}%`;
    updateVolSliderFill();
    persist();
  });

  speedSelect.addEventListener('change', persist);
  loopToggle.addEventListener('change', () => {
    if (loopToggle.checked && autoplayNextToggle.checked) {
      autoplayNextToggle.checked = false;
    }
    persist();
  });
  autoplayNextToggle.addEventListener('change', () => {
    if (autoplayNextToggle.checked && loopToggle.checked) {
      loopToggle.checked = false;
    }
    persist();
  });
  autoplayToggle.addEventListener('change', persist);
  savePositionToggle.addEventListener('change', persist);

  resetBtn.addEventListener('click', () => {
    if (!confirm('設定をすべてリセットしますか？')) return;
    localStorage.removeItem('chocotube_settings');
    const def = getSettings();
    speedSelect.value            = String(def.defaultSpeed);
    loopToggle.checked           = def.loop;
    autoplayNextToggle.checked   = def.autoplayNext;
    autoplayToggle.checked       = def.autoplay !== false;
    savePositionToggle.checked   = !!def.savePosition;
    volumeSlider.value           = String(def.defaultVolume);
    volumeValue.textContent      = `${def.defaultVolume}%`;
    updateVolSliderFill();
    showToast();
  });

  clearHistBtn.addEventListener('click', () => {
    if (!confirm('視聴履歴をすべて削除しますか？')) return;
    clearHistory();
    showToast();
  });

  clearFavBtn.addEventListener('click', () => {
    if (!confirm('お気に入りをすべて削除しますか？')) return;
    localStorage.removeItem('chocotube_favorites');
    showToast();
  });
}
})();
