(() => {
  const $ = id => document.getElementById(id);
  const v = $('v'), ph = $('ph'), vInner = $('vInner');
  const vInfo = $('vInfo'), barFill = $('barFill');
  const led = $('led'), statusText = $('statusText'), noteDisplay = $('noteDisplay'), mirrorStatus = $('mirrorStatus'), bpmEl = $('bpm');
  
  let audioCtx, masterGain, recDest;
  let mediaRecorder, recChunks = [], isExporting = false;
  let combined, lastBlob;
  let isMirror = false;
  let parsedTracks = [], selTrack = 'all', midiBPM = 120, midiTPB = 480;
  let playerTimer, playerEvents = [], playerIdx = 0, playerPaused = false, playerStopped = false;
  let totalDur = 0, exportStart = 0;
  const activeOscs = new Map();
  
  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d', { alpha: false });
  let lastFrame = 0, targetInterval = 33, rafId;
  
  const resMap = { '480': [854, 480], '720': [1280, 720], '1080': [1920, 1080], '1440': [2560, 1440] };
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) { $('res').value = '480'; $('fps').value = '24'; $('bitrate').value = '5'; $('bitrateVal').textContent = '5M'; }

  // ===== 音频引擎 =====
  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = parseFloat($('vol').value) / 100;
      recDest = audioCtx.createMediaStreamDestination();
      masterGain.connect(audioCtx.destination);
      masterGain.connect(recDest);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  
  function playTone(note, vel) {
    if (!audioCtx) return;
    const old = activeOscs.get(note);
    if (old) { try { old.osc.stop(); old.gain.disconnect(); } catch(e) {} }
    const f = 440 * Math.pow(2, (note - 69) / 12);
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(Math.min(1, vel/127) * 0.2, audioCtx.currentTime);
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
      try { old.gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03); } catch(e) {}
      setTimeout(() => { try { old.osc.stop(); old.gain.disconnect(); } catch(e) {} }, 80);
      activeOscs.delete(note);
    }
  }
  
  function stopAllTones() { activeOscs.forEach(v => { try { v.osc.stop(); v.gain.disconnect(); } catch(e) {} }); activeOscs.clear(); }

  // ===== 镜像控制 =====
  function setMirror(on) {
    vInner.classList.toggle('flip', on);
    isMirror = on;
    mirrorStatus.textContent = on ? '翻转' : '正常';
    led.classList.toggle('on', on);
  }
  
  function forceFlip() {
    setMirror(!isMirror);
    if (v.src && v.src !== location.href) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }
  
  function resetMirror() {
    setMirror(false);
    noteDisplay.textContent = '—';
    if (v.src && v.src !== location.href) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
  }
  
  function noteOn(note, vel = 100) {
    forceFlip();
    playTone(note, vel);
    noteDisplay.textContent = note;
  }
  
  function noteOff(note) {
    stopTone(note);
  }

  // ===== 导出核心 =====
  function setupCanvas() {
    const [bw, bh] = resMap[$('res').value] || [1280, 720];
    let w = bw, h = bh;
    if (v.videoWidth && v.videoHeight) {
      const r = v.videoHeight / v.videoWidth;
      w = bw;
      h = Math.round(bw * r);
    }
    offCanvas.width = w;
    offCanvas.height = h;
  }
  
  function drawFrame() {
    if (!mediaRecorder) return;
    const w = offCanvas.width, h = offCanvas.height;
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
    } catch(e) {}
    const canvas = mediaRecorder._canvas;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offCanvas, 0, 0, canvas.width, canvas.height);
    }
  }

  function startExport() {
    if (isExporting) return;
    if (!v.src || v.src === location.href) {
      alert('请先加载视频');
      return;
    }
    if (!playerEvents || playerEvents.length === 0) {
      alert('请先加载MIDI文件');
      return;
    }
    initAudio();
    setupCanvas();
    
    const canvas = document.createElement('canvas');
    canvas.width = offCanvas.width;
    canvas.height = offCanvas.height;
    mediaRecorder = null;
    recChunks = [];
    
    const stream = canvas.captureStream(parseInt($('fps').value));
    combined = new MediaStream([...stream.getVideoTracks(), ...recDest.stream.getAudioTracks()]);
    
    const mts = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
    let mt = '';
    for (const m of mts) {
      if (MediaRecorder.isTypeSupported(m)) { mt = m; break; }
    }
    if (!mt) {
      alert('您的浏览器不支持导出');
      return;
    }
    
    mediaRecorder = new MediaRecorder(combined, {
      mimeType: mt,
      videoBitsPerSecond: parseInt($('bitrate').value) * 1000000,
      audioBitsPerSecond: 96000
    });
    mediaRecorder._canvas = canvas;
    
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recChunks.push(e.data);
    };
    
    mediaRecorder.onstop = () => {
      lastBlob = new Blob(recChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(lastBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mirror-export-'+Date.now()+'.webm';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      isExporting = false;
      $('exportBtn').disabled = false;
      $('cancelBtn').disabled = true;
      statusText.textContent = '导出完成 ✅';
      barFill.style.width = '100%';
      setTimeout(() => { barFill.style.width = '0%'; }, 2000);
    };
    
    mediaRecorder.start(100);
    isExporting = true;
    $('exportBtn').disabled = true;
    $('cancelBtn').disabled = false;
    statusText.textContent = '导出中...';
    exportStart = Date.now();
    lastFrame = 0;
    
    stopAllTones();
    resetMirror();
    playerIdx = 0;
    playerPaused = false;
    playerStopped = false;
    scheduleNextExport();
  }

  function scheduleNextExport() {
    if (!isExporting || !mediaRecorder) return;
    if (playerIdx >= playerEvents.length) {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.requestData();
        mediaRecorder.stop();
      }
      return;
    }
    const ev = playerEvents[playerIdx];
    playerTimer = setTimeout(() => {
      if (!isExporting) return;
      drawFrame();
      if (ev.type === 'noteOn') noteOn(ev.noteNumber, ev.velocity);
      else noteOff(ev.noteNumber);
      playerIdx++;
      const progress = totalDur > 0 ? (playerIdx / playerEvents.length) * 100 : 0;
      barFill.style.width = Math.min(100, progress) + '%';
      scheduleNextExport();
    }, ev.delta);
  }

  function cancelExport() {
    if (!isExporting) return;
    isExporting = false;
    if (playerTimer) { clearTimeout(playerTimer); playerTimer = null; }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.requestData();
      mediaRecorder.stop();
    }
    stopAllTones();
    resetMirror();
    $('exportBtn').disabled = false;
    $('cancelBtn').disabled = true;
    statusText.textContent = '已取消';
    barFill.style.width = '0%';
  }

  // ===== MIDI解析 =====
  function getTickMs(dt) { return (dt * (60 / midiBPM) / midiTPB) * 1000; }
  
  function rebuild() {
    if (!parsedTracks?.length) { playerEvents = []; totalDur = 0; return; }
    let filtered = selTrack === 'all' ? parsedTracks : parsedTracks.filter(t => t.trackIndex === parseInt(selTrack));
    const all = [];
    filtered.forEach(t => t.events.forEach(e => all.push(e)));
    all.sort((a, b) => a.tickTime - b.tickTime);
    playerEvents = [];
    let last = 0;
    all.forEach(e => {
      playerEvents.push({ ...e, delta: Math.max(1, getTickMs(e.tickTime - last)) });
      last = e.tickTime;
    });
    totalDur = all.length ? getTickMs(all[all.length - 1].tickTime) + 2000 : 0;
    $('exportBtn').disabled = !(v.src && v.src !== location.href && playerEvents.length > 0);
  }
  
  function popTracks(tracks) {
    const sel = $('track');
    sel.innerHTML = '<option value="all">全部</option>';
    tracks.forEach(t => {
      const o = document.createElement('option');
      o.value = t.trackIndex;
      o.textContent = '轨'+t.trackIndex;
      sel.appendChild(o);
    });
    sel.value = 'all';
    selTrack = 'all';
  }
  
  $('track').addEventListener('change', e => {
    selTrack = e.target.value;
    if (isExporting) { cancelExport(); }
    stopAllTones();
    resetMirror();
    rebuild();
  });
  
  async function loadMidi(file) {
    if (isExporting) cancelExport();
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
      if (!parsedTracks.length) { alert('无音符'); return; }
      popTracks(parsedTracks);
      rebuild();
      statusText.textContent = file.name;
    } catch(e) {
      alert('MIDI解析失败');
    }
  }
  
  function parseMidi(data) {
    const tracks = [];
    let pos = 0, tpb = 480, bpm = 120;
    if (data.length < 14) return { tracks, bpm, ticksPerBeat: tpb };
    if (String.fromCharCode(...data.slice(pos, pos + 4)) !== 'MThd') throw new Error('无效');
    pos += 4;
    const hl = (data[pos]<<24)|(data[pos+1]<<16)|(data[pos+2]<<8)|data[pos+3];
    pos += 4;
    tpb = (data[pos+4]<<8)|data[pos+5];
    pos += hl;
    let ti = 0;
    while (pos < data.length - 8) {
      const ct = String.fromCharCode(...data.slice(pos, pos+4));
      pos += 4;
      const cl = (data[pos]<<24)|(data[pos+1]<<16)|(data[pos+2]<<8)|data[pos+3];
      pos += 4;
      if (ct !== 'MTrk') { pos += cl; continue; }
      const te = pos + cl;
      let rs = null, events = [], tickTime = 0;
      while (pos < te) {
        let dr = readVarInt(data, pos);
        pos = dr.nextPos;
        tickTime += dr.value;
        let et = data[pos], sb = et;
        if (et < 0x80) { if (rs === null) { pos++; continue; } sb = rs; } else { pos++; rs = et; }
        const mt = sb & 0xF0;
        if (mt === 0x90 || mt === 0x80) {
          if (pos + 1 >= te) break;
          const nn = data[pos], vv = data[pos+1];
          pos += 2;
          if (mt === 0x90 && vv > 0) events.push({ tickTime, type: 'noteOn', noteNumber: nn, velocity: vv });
          else if (mt === 0x80 || (mt === 0x90 && vv === 0)) events.push({ tickTime, type: 'noteOff', noteNumber: nn });
        } else if (sb === 0xFF) {
          if (pos >= te) break;
          const metaType = data[pos++];
          const mlr = readVarInt(data, pos);
          pos = mlr.nextPos;
          if (metaType === 0x51 && mlr.value === 3) {
            bpm = Math.round(60000000 / ((data[pos]<<16)|(data[pos+1]<<8)|data[pos+2]));
          }
          pos += mlr.value;
        } else if (mt === 0xB0 || mt === 0xE0) pos += 2;
        else if (mt === 0xC0 || mt === 0xD0) pos += 1;
        else break;
      }
      if (events.length) tracks.push({ trackIndex: ti, events });
      ti++;
      pos = te;
    }
    return { tracks, bpm, ticksPerBeat: tpb };
  }
  
  function readVarInt(data, offset) {
    let vv = 0, p = offset;
    for (let i = 0; i < 4; i++) {
      if (p >= data.length) break;
      const b = data[p];
      vv = (vv << 7) | (b & 0x7F);
      p++;
      if (!(b & 0x80)) break;
    }
    return { value: vv, nextPos: p };
  }

  // ===== 事件绑定 =====
  $('exportBtn').addEventListener('click', () => {
    initAudio();
    startExport();
  });
  $('cancelBtn').addEventListener('click', cancelExport);
  
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
      $('exportBtn').disabled = !(v.src && v.src !== location.href && playerEvents.length > 0);
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
  
  $('bitrate').addEventListener('input', e => {
    $('bitrateVal').textContent = e.target.value + 'M';
  });
  $('vol').addEventListener('input', e => {
    const vv = e.target.value / 100;
    if (masterGain) masterGain.gain.setTargetAtTime(vv, audioCtx?.currentTime || 0, 0.01);
    $('volVal').textContent = e.target.value + '%';
  });

  // ===== 初始化 =====
  setMirror(false);
  $('exportBtn').disabled = true;
  $('cancelBtn').disabled = true;
  statusText.textContent = '就绪';
})();