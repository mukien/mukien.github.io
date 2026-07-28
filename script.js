(function() {
  'use strict';

  // ===== DOM 引用 =====
  const $ = id => document.getElementById(id);
  const v = $('v');
  const ph = $('ph');
  const vInner = $('vInner');
  const vInfo = $('vInfo');
  const barFill = $('barFill');
  const led = $('led');
  const status = $('status');
  const noteEl = $('note');
  const mirrorEl = $('mirror');
  const bpmEl = $('bpm');

  // ===== 音频相关 =====
  let audioCtx = null;
  let masterGain = null;
  let recDest = null;
  let mediaRecorder = null;
  let recChunks = [];
  let isRec = false;
  let recCtx = null;
  let combined = null;
  let lastBlob = null;
  let isMirror = false;

  // ===== MIDI相关 =====
  let parsedTracks = [];
  let selTrack = 'all';
  let midiBPM = 120;
  let midiTPB = 480;
  let playerTimer = null;
  let playerEvents = [];
  let playerIdx = 0;
  let playerPaused = false;
  let playerStopped = false;
  let totalDur = 0;
  let recStart = 0;

  // ===== 音频振荡器 =====
  const activeOscs = new Map();

  // ===== 离屏Canvas =====
  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d', { alpha: false });
  let lastFrame = 0;
  let targetInterval = 33;
  let rafId = null;

  // ===== 分辨率映射 =====
  const resMap = {
    '480': [854, 480],
    '720': [1280, 720],
    '1080': [1920, 1080],
    '1440': [2560, 1440]
  };

  // ===== 移动端检测 =====
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    $('res').value = '480';
    $('fps').value = '24';
    $('bitrate').value = '5';
    $('bitrateVal').textContent = '5M';
  }

  // ==========================================
  //  音频初始化
  // ==========================================
  function initAudio() {
    if (!audioCtx) {
      audioCtx = new(window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.6;
      recDest = audioCtx.createMediaStreamDestination();
      masterGain.connect(audioCtx.destination);
      masterGain.connect(recDest);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // ==========================================
  //  音符播放
  // ==========================================
  function playTone(note, vel) {
    if (!audioCtx) return;
    const old = activeOscs.get(note);
    if (old) {
      try {
        old.osc.stop();
        old.gain.disconnect();
      } catch (e) {}
    }
    const f = 440 * Math.pow(2, (note - 69) / 12);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(Math.min(1, vel / 127) * 0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.8);
    activeOscs.set(note, { osc, gain });
  }

  function stopTone(note) {
    const old = activeOscs.get(note);
    if (old) {
      try {
        old.gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03);
      } catch (e) {}
      setTimeout(() => {
        try {
          old.osc.stop();
          old.gain.disconnect();
        } catch (e) {}
      }, 80);
      activeOscs.delete(note);
    }
  }

  function stopAllTones() {
    activeOscs.forEach(v => {
      try {
        v.osc.stop();
        v.gain.disconnect();
      } catch (e) {}
    });
    activeOscs.clear();
  }

  // ==========================================
  //  镜像控制
  // ==========================================
  function setMirror(on) {
    vInner.classList.toggle('flip', on);
    isMirror = on;
    mirrorEl.textContent = on ? '翻转' : '正常';
    led.classList.toggle('on', on);
  }

  function forceFlip() {
    const newState = !isMirror;
    setMirror(newState);
    if (v.src && v.src !== location.href) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }

  function resetMirror() {
    setMirror(false);
    noteEl.textContent = '—';
    if (v.src && v.src !== location.href) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }

  // ==========================================
  //  音符事件 - 每个音符触发翻转
  // ==========================================
  function noteOn(note, vel = 100) {
    forceFlip();
    playTone(note, vel);
    noteEl.textContent = note;
  }

  function noteOff(note) {
    stopTone(note);
  }

  // ==========================================
  //  录制功能
  // ==========================================
  function setupCanvas() {
    const [bw, bh] = resMap[$('res').value] || [1280, 720];
    let w = bw,
      h = bh;
    if (v.videoWidth && v.videoHeight) {
      const r = v.videoHeight / v.videoWidth;
      w = bw;
      h = Math.round(bw * r);
    }
    offCanvas.width = w;
    offCanvas.height = h;
  }

  function drawFrame() {
    if (!recCtx) return;
    const w = offCanvas.width,
      h = offCanvas.height;
    offCtx.fillStyle = '#000';
    offCtx.fillRect(0, 0, w, h);
    try {
      if (isMirror) {
        offCtx.save();
        offCtx.scale(-1, 1);
        offCtx.drawImage(v, -w, 0, w, h);
        offCtx.restore();
      } else {
        offCtx.drawImage(v, 0, 0, w, h);
      }
    } catch (e) {}
    recCtx.drawImage(offCanvas, 0, 0);
  }

  function recLoop(ts) {
    if (!isRec) return;
    if (ts - lastFrame >= targetInterval) {
      drawFrame();
      lastFrame = ts;
      if (totalDur > 0) {
        barFill.style.width = Math.min(100, ((Date.now() - recStart) / totalDur) * 100) + '%';
      }
    }
    rafId = requestAnimationFrame(recLoop);
  }

  async function startRec() {
    if (isRec) return;
    if (!v.src || v.src === location.href) {
      alert('请先加载视频');
      return false;
    }
    initAudio();
    setupCanvas();

    const canvas = document.createElement('canvas');
    canvas.width = offCanvas.width;
    canvas.height = offCanvas.height;
    recCtx = canvas.getContext('2d', { alpha: false });
    targetInterval = 1000 / parseInt($('fps').value);

    const stream = canvas.captureStream(parseInt($('fps').value));
    combined = new MediaStream([
      ...stream.getVideoTracks(),
      ...recDest.stream.getAudioTracks()
    ]);

    const mts = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    let mt = '';
    for (const m of mts) {
      if (MediaRecorder.isTypeSupported(m)) {
        mt = m;
        break;
      }
    }
    if (!mt) {
      alert('不支持录制');
      return false;
    }

    recChunks = [];
    mediaRecorder = new MediaRecorder(combined, {
      mimeType: mt,
      videoBitsPerSecond: parseInt($('bitrate').value) * 1000000,
      audioBitsPerSecond: 96000
    });

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      lastBlob = new Blob(recChunks, { type: 'video/webm' });
      $('saveBtn').disabled = false;
      $('c1').disabled = false;
      $('c2').disabled = false;
      updateRecUI(false);
    };

    mediaRecorder.start(isMobile ? 1000 : 200);
    isRec = true;
    recStart = Date.now();
    lastFrame = 0;
    updateRecUI(true);
    rafId = requestAnimationFrame(recLoop);
    return true;
  }

  function stopRec() {
    if (!isRec || !mediaRecorder) return;
    isRec = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (mediaRecorder.state === 'recording') {
      mediaRecorder.requestData();
      mediaRecorder.stop();
    }
    if (combined) {
      combined.getTracks().forEach(t => t.stop());
    }
    barFill.style.width = '0%';
    updateRecUI(false);
  }

  function updateRecUI(rec) {
    const btn = $('recBtn');
    btn.textContent = rec ? '⏹' : '🔴';
    btn.classList.toggle('on', rec);
    $('saveBtn').disabled = rec;
    $('c1').disabled = rec || !lastBlob;
    $('c2').disabled = rec || !lastBlob;
  }

  function save() {
    if (!lastBlob) return;
    const u = URL.createObjectURL(lastBlob);
    const a = document.createElement('a');
    a.href = u;
    a.download = 'mirror-' + Date.now() + '.webm';
    a.click();
    URL.revokeObjectURL(u);
  }

  // ==========================================
  //  MIDI解析
  // ==========================================
  function getTickMs(dt) {
    return (dt * (60 / midiBPM) / midiTPB) * 1000;
  }

  function rebuild() {
    if (!parsedTracks || !parsedTracks.length) {
      playerEvents = [];
      totalDur = 0;
      return;
    }
    let filtered = selTrack === 'all' ?
      parsedTracks :
      parsedTracks.filter(t => t.trackIndex === parseInt(selTrack));

    const all = [];
    filtered.forEach(t => t.events.forEach(e => all.push(e)));
    all.sort((a, b) => a.tickTime - b.tickTime);

    playerEvents = [];
    let last = 0;
    all.forEach(e => {
      playerEvents.push({
        ...e,
        delta: Math.max(1, getTickMs(e.tickTime - last))
      });
      last = e.tickTime;
    });
    totalDur = all.length ? getTickMs(all[all.length - 1].tickTime) + 2000 : 0;
  }

  function popTracks(tracks) {
    const sel = $('track');
    sel.innerHTML = '<option value="all">全部</option>';
    tracks.forEach(t => {
      const o = document.createElement('option');
      o.value = t.trackIndex;
      o.textContent = '轨' + t.trackIndex;
      sel.appendChild(o);
    });
    sel.value = 'all';
    selTrack = 'all';
  }

  $('track').addEventListener('change', e => {
    selTrack = e.target.value;
    stopPlayer();
    stopAllTones();
    resetMirror();
    rebuild();
    if (playerEvents.length) startPlayer();
  });

  async function loadMidi(file) {
    stopPlayer();
    if (isRec) stopRec();
    stopAllTones();
    resetMirror();
    parsedTracks = [];
    playerEvents = [];
    $('track').innerHTML = '<option value="all">全部</option>';
    try {
      const buf = await file.arrayBuffer();
      const data = new Uint8Array(buf);
      const r = parseMidi(data);
      parsedTracks = r.tracks;
      midiBPM = r.bpm;
      midiTPB = r.ticksPerBeat;
      bpmEl.textContent = midiBPM;
      if (!parsedTracks.length) {
        alert('无音符');
        return;
      }
      popTracks(parsedTracks);
      rebuild();
      status.textContent = file.name;
      $('playBtn').disabled = false;
    } catch (e) {
      alert('解析失败');
      console.error(e);
    }
  }

  function parseMidi(data) {
    const tracks = [];
    let pos = 0;
    let tpb = 480;
    let bpm = 120;

    if (data.length < 14) return { tracks, bpm, ticksPerBeat: tpb };

    if (String.fromCharCode(...data.slice(pos, pos + 4)) !== 'MThd') {
      throw new Error('无效');
    }
    pos += 4;
    const hl = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
    pos += 4;
    tpb = (data[pos + 4] << 8) | data[pos + 5];
    pos += hl;

    let ti = 0;
    while (pos < data.length - 8) {
      const ct = String.fromCharCode(...data.slice(pos, pos + 4));
      pos += 4;
      const cl = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
      pos += 4;

      if (ct !== 'MTrk') {
        pos += cl;
        continue;
      }

      const te = pos + cl;
      let rs = null;
      const events = [];
      let tickTime = 0;

      while (pos < te) {
        let dr = readVarInt(data, pos);
        pos = dr.nextPos;
        tickTime += dr.value;

        let et = data[pos];
        let sb = et;
        if (et < 0x80) {
          if (rs === null) {
            pos++;
            continue;
          }
          sb = rs;
        } else {
          pos++;
          rs = et;
        }

        const mt = sb & 0xF0;
        if (mt === 0x90 || mt === 0x80) {
          if (pos + 1 >= te) break;
          const nn = data[pos];
          const vv = data[pos + 1];
          pos += 2;
          if (mt === 0x90 && vv > 0) {
            events.push({ tickTime, type: 'noteOn', noteNumber: nn, velocity: vv });
          } else if (mt === 0x80 || (mt === 0x90 && vv === 0)) {
            events.push({ tickTime, type: 'noteOff', noteNumber: nn });
          }
        } else if (sb === 0xFF) {
          if (pos >= te) break;
          const metaType = data[pos++];
          const mlr = readVarInt(data, pos);
          pos = mlr.nextPos;
          if (metaType === 0x51 && mlr.value === 3) {
            bpm = Math.round(60000000 / ((data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2]));
          }
          pos += mlr.value;
        } else if (mt === 0xB0 || mt === 0xE0) {
          pos += 2;
        } else if (mt === 0xC0 || mt === 0xD0) {
          pos += 1;
        } else {
          break;
        }
      }

      if (events.length) {
        tracks.push({ trackIndex: ti, events });
      }
      ti++;
      pos = te;
    }

    return { tracks, bpm, ticksPerBeat: tpb };
  }

  function readVarInt(data, offset) {
    let vv = 0;
    let p = offset;
    for (let i = 0; i < 4; i++) {
      if (p >= data.length) break;
      const b = data[p];
      vv = (vv << 7) | (b & 0x7F);
      p++;
      if (!(b & 0x80)) break;
    }
    return { value: vv, nextPos: p };
  }

  // ==========================================
  //  播放控制
  // ==========================================
  function startPlayer() {
    stopPlayer();
    if (!playerEvents || !playerEvents.length) return;
    playerIdx = 0;
    playerPaused = false;
    playerStopped = false;
    recStart = Date.now();
    startRec();
    updatePlayUI(true, false);
    scheduleNext();
  }

  function scheduleNext() {
    if (!playerEvents || !playerEvents.length || playerIdx >= playerEvents.length) {
      stopPlayer();
      status.textContent = '结束';
      updatePlayUI(false, false);
      $('playBtn').disabled = false;
      if (isRec) setTimeout(() => stopRec(), 2000);
      return;
    }
    if (playerPaused || playerStopped) return;

    const ev = playerEvents[playerIdx];
    playerTimer = setTimeout(() => {
      if (playerPaused || playerStopped) return;
      if (ev.type === 'noteOn') {
        noteOn(ev.noteNumber, ev.velocity);
      } else {
        noteOff(ev.noteNumber);
      }
      playerIdx++;
      scheduleNext();
    }, ev.delta);
  }

  function pausePlayer() {
    if (!playerTimer || playerPaused) return;
    clearTimeout(playerTimer);
    playerPaused = true;
    if (isRec && mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
    }
    updatePlayUI(false, true);
  }

  function resumePlayer() {
    if (!playerPaused) return;
    playerPaused = false;
    if (isRec && mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
    }
    updatePlayUI(true, false);
    scheduleNext();
  }

  function stopPlayer() {
    if (playerTimer) {
      clearTimeout(playerTimer);
      playerTimer = null;
    }
    playerPaused = false;
    playerStopped = true;
    playerIdx = 0;
    stopAllTones();
    resetMirror();
    if (isRec) stopRec();
    updatePlayUI(false, false);
    $('playBtn').disabled = !playerEvents || !playerEvents.length;
    status.textContent = '已停止';
  }

  function updatePlayUI(playing, paused) {
    $('playBtn').disabled = playing;
    $('pauseBtn').disabled = !playing;
    $('stopBtn').disabled = !playing && !paused;
  }

  // ==========================================
  //  事件绑定
  // ==========================================
  // 播放控制
  $('playBtn').addEventListener('click', () => {
    initAudio();
    if (playerPaused) {
      resumePlayer();
    } else {
      playerIdx = 0;
      playerStopped = false;
      resetMirror();
      startPlayer();
    }
  });

  $('pauseBtn').addEventListener('click', pausePlayer);
  $('stopBtn').addEventListener('click', stopPlayer);
  $('recBtn').addEventListener('click', () => isRec ? stopRec() : startRec());
  $('saveBtn').addEventListener('click', save);

  // 转换按钮
  $('c1').addEventListener('click', () => {
    if (lastBlob) {
      save();
      window.open('https://cloudconvert.com/webm-to-mp4', '_blank');
    }
  });

  $('c2').addEventListener('click', () => {
    if (lastBlob) {
      save();
      window.open('https://convertio.co/webm-mp4/', '_blank');
    }
  });

  // 文件选择
  $('vBtn').addEventListener('click', () => $('vInput').click());
  $('vInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    vInfo.textContent = f.name;
    const u = URL.createObjectURL(f);
    v.src = u;
    v.style.display = 'block';
    ph.style.display = 'none';
    v.onloadeddata = () => {
      vInfo.textContent = f.name + ' (' + v.videoWidth + 'x' + v.videoHeight + ')';
      v.play().catch(() => {});
    };
    v.load();
  });

  $('mBtn').addEventListener('click', () => $('mInput').click());
  $('mInput').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    initAudio();
    await loadMidi(f);
  });

  // 滑条控制
  $('bitrate').addEventListener('input', e => {
    $('bitrateVal').textContent = e.target.value + 'M';
  });

  $('vol').addEventListener('input', e => {
    const vv = e.target.value / 100;
    if (masterGain) {
      masterGain.gain.setTargetAtTime(vv, audioCtx?.currentTime || 0, 0.01);
    }
    $('volVal').textContent = e.target.value + '%';
  });

  // ==========================================
  //  初始化
  // ==========================================
  setMirror(false);
  updateRecUI(false);
  updatePlayUI(false, false);

  console.log('🎵 MIDI镜像翻转 · 已加载');
})();