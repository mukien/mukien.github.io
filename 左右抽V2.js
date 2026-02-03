// script.js
// 全局变量
let midiData = null;
let selectedTrack = null;
let isPreviewing = false;
let isGenerating = false;
let flipCount = 0;
let imageElement = document.getElementById('preview-image');
let canvas = document.getElementById('preview-canvas');
let ctx = canvas.getContext('2d', { alpha: false });
let flipIndicator = document.getElementById('flip-indicator');
let resolutionBadge = document.getElementById('resolution-badge');
let statusElement = document.getElementById('status');

// 分辨率映射
const RESOLUTIONS = {
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '2k': { width: 2560, height: 1440 },
    '4k': { width: 3840, height: 2160 }
};

// DOM元素
const midiUploadArea = document.getElementById('midi-upload');
const midiFileInput = document.getElementById('midi-file');
const midiInfo = document.getElementById('midi-info');
const midiName = document.getElementById('midi-name');
const midiSize = document.getElementById('midi-size');
const removeMidiBtn = document.getElementById('remove-midi');

const imageUploadArea = document.getElementById('image-upload');
const imageFileInput = document.getElementById('image-file');
const imageInfo = document.getElementById('image-info');
const imageName = document.getElementById('image-name');
const imageSize = document.getElementById('image-size');
const removeImageBtn = document.getElementById('remove-image');

const trackSelect = document.getElementById('track-select');
const resolutionSelect = document.getElementById('resolution');
const fpsInput = document.getElementById('fps');
const durationInput = document.getElementById('duration');
const previewBtn = document.getElementById('preview-btn');
const generateBtn = document.getElementById('generate-btn');
const stopBtn = document.getElementById('stop-btn');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const videoOutput = document.getElementById('video-output');
const outputVideo = document.getElementById('output-video');
const downloadBtn = document.getElementById('download-btn');
const qualityBtns = document.querySelectorAll('.quality-btn');

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('页面加载完成，初始化应用...');
    
    // 设置Canvas初始分辨率
    updateCanvasResolution();
    
    // 设置事件监听器
    setupEventListeners();
    
    // 更新按钮状态
    updateButtonStates();
    
    // 更新分辨率标签
    updateResolutionBadge();
    
    console.log('应用初始化完成');
});

// 设置事件监听器
function setupEventListeners() {
    console.log('设置事件监听器...');
    
    // 文件输入直接点击
    midiFileInput.addEventListener('change', handleMidiFileSelect);
    imageFileInput.addEventListener('change', handleImageFileSelect);
    
    // 上传区域点击事件 - 直接触发文件输入
    midiUploadArea.addEventListener('click', function() {
        console.log('点击MIDI上传区域');
        midiFileInput.click();
    });
    
    imageUploadArea.addEventListener('click', function() {
        console.log('点击图片上传区域');
        imageFileInput.click();
    });
    
    // 移除按钮事件
    removeMidiBtn.addEventListener('click', removeMidiFile);
    removeImageBtn.addEventListener('click', removeImageFile);
    
    // 音轨选择事件
    trackSelect.addEventListener('change', function() {
        selectedTrack = parseInt(this.value);
        updateButtonStates();
        
        if (!isNaN(selectedTrack)) {
            const track = midiData.tracks[selectedTrack];
            const trackName = track.name || `音轨 ${selectedTrack + 1}`;
            statusElement.textContent = `已选择: ${trackName}，包含 ${track.notes.length} 个音符`;
        }
    });
    
    // 分辨率选择事件
    resolutionSelect.addEventListener('change', updateCanvasResolution);
    
    // 质量预设按钮事件
    qualityBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            qualityBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    // 控制按钮事件
    previewBtn.addEventListener('click', startPreview);
    generateBtn.addEventListener('click', generateVideo);
    stopBtn.addEventListener('click', stopAll);
    
    // 拖放事件
    setupDragAndDrop();
    
    // 下载按钮事件
    downloadBtn.addEventListener('click', downloadVideo);
    
    console.log('事件监听器设置完成');
}

// 设置拖放功能
function setupDragAndDrop() {
    // MIDI文件拖放
    midiUploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.add('highlight');
    });
    
    midiUploadArea.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('highlight');
    });
    
    midiUploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('highlight');
        
        if (e.dataTransfer.files.length) {
            handleMidiFile(e.dataTransfer.files[0]);
        }
    });
    
    // 图片文件拖放
    imageUploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.add('highlight');
    });
    
    imageUploadArea.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('highlight');
    });
    
    imageUploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('highlight');
        
        if (e.dataTransfer.files.length) {
            handleImageFile(e.dataTransfer.files[0]);
        }
    });
}

// 处理MIDI文件选择
async function handleMidiFileSelect(e) {
    console.log('MIDI文件选择事件触发');
    if (e.target.files.length) {
        await handleMidiFile(e.target.files[0]);
    }
}

// 处理图片文件选择
async function handleImageFileSelect(e) {
    console.log('图片文件选择事件触发');
    if (e.target.files.length) {
        await handleImageFile(e.target.files[0]);
    }
}

// 处理MIDI文件
async function handleMidiFile(file) {
    console.log('处理MIDI文件:', file.name);
    
    if (!file.name.toLowerCase().match(/\.(mid|midi)$/)) {
        alert('请选择MIDI文件 (.mid 或 .midi)');
        return;
    }
    
    try {
        statusElement.textContent = '正在加载MIDI文件...';
        
        const arrayBuffer = await file.arrayBuffer();
        midiData = new Midi(arrayBuffer);
        
        // 显示文件信息
        midiName.textContent = file.name;
        midiSize.textContent = formatFileSize(file.size);
        midiInfo.classList.remove('hidden');
        
        // 填充音轨选择器
        populateTrackSelector();
        
        statusElement.textContent = `MIDI文件加载成功！包含 ${midiData.tracks.length} 个音轨`;
        updateButtonStates();
        
        console.log('MIDI文件处理完成');
    } catch (error) {
        console.error('MIDI文件加载失败:', error);
        statusElement.textContent = 'MIDI文件加载失败，请确保是有效的MIDI文件';
    }
}

// 处理图片文件
async function handleImageFile(file) {
    console.log('处理图片文件:', file.name);
    
    if (!file.type.match('image.*')) {
        alert('请选择图片文件');
        return;
    }
    
    try {
        // 创建临时URL预览图片
        const imageUrl = URL.createObjectURL(file);
        const img = new Image();
        
        img.onload = () => {
            URL.revokeObjectURL(imageUrl);
            
            // 显示文件信息
            imageName.textContent = file.name;
            imageSize.textContent = `${formatFileSize(file.size)} | ${img.width}×${img.height}像素`;
            imageInfo.classList.remove('hidden');
            
            // 设置图片源
            const reader = new FileReader();
            reader.onload = (e) => {
                imageElement.src = e.target.result;
                
                // 图片加载后更新Canvas
                imageElement.onload = () => {
                    updateCanvasResolution();
                    drawImageToCanvas(false);
                };
            };
            reader.readAsDataURL(file);
            
            updateButtonStates();
            statusElement.textContent = `图片加载成功！分辨率: ${img.width}×${img.height}`;
        };
        
        img.onerror = () => {
            URL.revokeObjectURL(imageUrl);
            alert('图片加载失败，请选择有效的图片文件');
        };
        
        img.src = imageUrl;
        
        console.log('图片文件处理完成');
    } catch (error) {
        console.error('图片文件处理失败:', error);
        statusElement.textContent = '图片文件处理失败: ' + error.message;
    }
}

// 填充音轨选择器
function populateTrackSelector() {
    console.log('填充音轨选择器');
    trackSelect.innerHTML = '';
    trackSelect.disabled = false;
    
    // 添加默认选项
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '请选择用于触发镜像的音轨';
    trackSelect.appendChild(defaultOption);
    
    // 添加每个音轨的选项
    midiData.tracks.forEach((track, index) => {
        const option = document.createElement('option');
        option.value = index;
        
        const trackName = track.name || `音轨 ${index + 1}`;
        const noteCount = track.notes.length;
        const trackDuration = track.duration ? Math.round(track.duration) : '未知';
        
        option.textContent = `${trackName} - ${noteCount}音符 - ${trackDuration}秒`;
        trackSelect.appendChild(option);
    });
    
    console.log('音轨选择器填充完成');
}

// 移除MIDI文件
function removeMidiFile() {
    console.log('移除MIDI文件');
    midiData = null;
    midiInfo.classList.add('hidden');
    trackSelect.innerHTML = '<option value="">请先上传MIDI文件</option>';
    trackSelect.disabled = true;
    selectedTrack = null;
    
    if (isPreviewing || isGenerating) {
        stopAll();
    }
    
    updateButtonStates();
    statusElement.textContent = 'MIDI文件已移除';
}

// 移除图片文件
function removeImageFile() {
    console.log('移除图片文件');
    imageElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjMyMCIgdmlld0JveD0iMCAwIDMyMCAzMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIzMjAiIGZpbGw9InJnYmEoMjAsIDI1LCA4MCwgMC4xNSkiLz48cGF0aCBkPSJNMTYwIDgwTDIyMCAxNjBMMTYwIDI0MEwxMDAgMTYwTDE2MCA4MFoiIGZpbGw9InJnYmEoODYsIDEwOSwgMjI5LCAwLjIpIiBzdHJva2U9IiM1NDZkZTUiIHN0cm9rZS13aWR0aD0iMiIvPjx0ZXh0IHg9IjUwJSIgeT0iNDUlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJyZ2JhKDI1NSwgMjU1LCAyNTUsIDAuOCkiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNHB4IiBmb250LXdlaWdodD0iNjAwIj5VcGxvYWQgSGlnaC1SZXMgSW1hZ2U8L3RleHQ+PHRleHQgeD0iNTAlIiB5PSI1NSUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9InJnYmEoMjU1LCAyNTMsIDI1NSwgMC42KSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2cHgiPmZvciBiZXN0IHZpZGVvIHF1YWxpdHk8L3RleHQ+PC9zdmc+';
    imageInfo.classList.add('hidden');
    
    if (isPreviewing || isGenerating) {
        stopAll();
    }
    
    updateButtonStates();
    statusElement.textContent = '图片已移除';
}

// 更新Canvas分辨率
function updateCanvasResolution() {
    const resolution = resolutionSelect.value;
    const res = RESOLUTIONS[resolution];
    
    // 设置Canvas尺寸为实际分辨率
    canvas.width = res.width;
    canvas.height = res.height;
    
    // 更新分辨率标签
    resolutionBadge.textContent = resolution.toUpperCase();
    resolutionBadge.style.display = 'block';
    
    // 如果图片已加载，重新绘制
    if (imageElement.complete && imageElement.naturalWidth > 0) {
        drawImageToCanvas(false);
    }
}

// 更新分辨率标签
function updateResolutionBadge() {
    resolutionBadge.textContent = resolutionSelect.value.toUpperCase();
    resolutionBadge.style.display = 'block';
}

// 绘制图片到Canvas
function drawImageToCanvas(flipped) {
    if (!ctx || !imageElement.complete) return;
    
    // 清除Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 设置高质量渲染
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // 计算图片位置和尺寸
    const imgWidth = imageElement.naturalWidth;
    const imgHeight = imageElement.naturalHeight;
    
    // 计算最佳缩放比例
    const scale = Math.min(canvas.width / imgWidth, canvas.height / imgHeight);
    const width = imgWidth * scale;
    const height = imgHeight * scale;
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    
    ctx.save();
    
    if (flipped) {
        // 水平镜像翻转
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(imageElement, canvas.width - x - width, y, width, height);
    } else {
        ctx.drawImage(imageElement, x, y, width, height);
    }
    
    ctx.restore();
}

// 绘制图片到离屏Canvas（用于视频生成）
function drawImageToOffscreenCanvas(flipped, offscreenCtx, width, height) {
    if (!offscreenCtx || !imageElement.complete) return;
    
    // 清除Canvas
    offscreenCtx.clearRect(0, 0, width, height);
    
    // 设置高质量渲染
    offscreenCtx.imageSmoothingEnabled = true;
    offscreenCtx.imageSmoothingQuality = 'high';
    
    // 计算图片位置和尺寸
    const imgWidth = imageElement.naturalWidth;
    const imgHeight = imageElement.naturalHeight;
    
    // 计算最佳缩放比例
    const scale = Math.min(width / imgWidth, height / imgHeight);
    const scaledWidth = imgWidth * scale;
    const scaledHeight = imgHeight * scale;
    const x = (width - scaledWidth) / 2;
    const y = (height - scaledHeight) / 2;
    
    offscreenCtx.save();
    
    if (flipped) {
        // 水平镜像翻转
        offscreenCtx.translate(width, 0);
        offscreenCtx.scale(-1, 1);
        offscreenCtx.drawImage(imageElement, width - x - scaledWidth, y, scaledWidth, scaledHeight);
    } else {
        offscreenCtx.drawImage(imageElement, x, y, scaledWidth, scaledHeight);
    }
    
    offscreenCtx.restore();
}

// 开始预览
function startPreview() {
    if (isPreviewing || !midiData || isNaN(selectedTrack)) return;
    
    console.log('开始预览');
    isPreviewing = true;
    flipCount = 0;
    updateButtonStates();
    
    // 显示Canvas，隐藏图片
    canvas.style.display = 'block';
    imageElement.style.display = 'none';
    
    // 获取选定的音轨
    const track = midiData.tracks[selectedTrack];
    
    if (track.notes.length === 0) {
        statusElement.textContent = '选定的音轨没有音符';
        isPreviewing = false;
        updateButtonStates();
        return;
    }
    
    // 初始绘制
    drawImageToCanvas(false);
    
    // 模拟播放
    simulatePreview(track);
    
    const trackName = track.name || '未命名';
    statusElement.innerHTML = `预览中 - 音轨: <span style="color:#4bcffa">${trackName}</span>，共 ${track.notes.length} 个音符`;
}

// 模拟预览
function simulatePreview(track) {
    const fps = 30;
    const duration = Math.min(10, track.duration || 10);
    const totalPreviewFrames = duration * fps;
    let currentFrame = 0;
    
    // 获取音符时间点
    const noteTimes = track.notes.map(note => note.time);
    const maxNoteTime = Math.max(...noteTimes);
    const timeScale = duration / maxNoteTime;
    const scaledNoteTimes = noteTimes.map(time => time * timeScale);
    
    let flipped = false;
    
    function animate() {
        if (!isPreviewing || currentFrame >= totalPreviewFrames) {
            stopPreview();
            return;
        }
        
        const currentTime = currentFrame / fps;
        
        // 检查是否有音符在这个时间点
        const noteIndex = scaledNoteTimes.findIndex(time => 
            Math.abs(time - currentTime) < (0.5 / fps)
        );
        
        if (noteIndex !== -1 && noteIndex % 2 === 0) {
            // 每两个音符翻转一次
            flipped = !flipped;
            flipCount++;
            
            // 显示翻转指示器
            showFlipIndicator();
            
            // 绘制翻转后的图片
            drawImageToCanvas(flipped);
            
            // 更新状态
            const note = track.notes[noteIndex];
            statusElement.innerHTML = `预览中 - 音符 ${noteIndex+1}/${track.notes.length}: <span style="color:#ff9ff3">${note.name}</span>`;
        }
        
        currentFrame++;
        setTimeout(animate, 1000 / fps);
    }
    
    animate();
}

// 显示翻转指示器
function showFlipIndicator() {
    flipIndicator.style.display = 'block';
    flipIndicator.style.animation = 'none';
    void flipIndicator.offsetWidth; // 触发重排
    flipIndicator.style.animation = 'flipIndicator 1s ease';
    
    setTimeout(() => {
        flipIndicator.style.display = 'none';
    }, 1000);
}

// 停止预览
function stopPreview() {
    isPreviewing = false;
    
    // 恢复图片显示
    canvas.style.display = 'none';
    imageElement.style.display = 'block';
    
    updateButtonStates();
    statusElement.textContent = `预览完成，共 ${flipCount} 次镜像翻转`;
}

// 生成视频
async function generateVideo() {
    if (isGenerating || !midiData || isNaN(selectedTrack)) return;
    
    console.log('开始生成视频');
    isGenerating = true;
    updateButtonStates();
    
    // 显示进度条
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = '准备生成高清视频...';
    
    try {
        // 获取设置
        const fps = parseInt(fpsInput.value) || 30;
        const duration = parseInt(durationInput.value) || 15;
        const track = midiData.tracks[selectedTrack];
        const trackName = track.name || `音轨 ${selectedTrack + 1}`;
        
        statusElement.textContent = `开始生成视频 - ${trackName}，${duration}秒，${fps}FPS`;
        
        // 创建离屏Canvas用于视频生成
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = canvas.width;
        offscreenCanvas.height = canvas.height;
        const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });
        
        // 检查浏览器支持
        const mimeType = getSupportedMimeType();
        if (!mimeType) {
            throw new Error('浏览器不支持视频录制功能');
        }
        
        // 创建视频流
        const stream = offscreenCanvas.captureStream(fps);
        const chunks = [];
        
        // 创建MediaRecorder
        const mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: getVideoBitrate()
        });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                chunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
            const videoURL = URL.createObjectURL(blob);
            outputVideo.src = videoURL;
            
            // 显示视频输出区域
            videoOutput.style.display = 'block';
            
            // 更新状态
            statusElement.textContent = `视频生成完成！${flipCount}次镜像翻转`;
            isGenerating = false;
            updateButtonStates();
            progressContainer.style.display = 'none';
            
            // 存储视频URL供下载使用
            outputVideo.dataset.videoUrl = videoURL;
        };
        
        // 开始录制
        mediaRecorder.start();
        
        // 生成视频帧
        const totalFrames = duration * fps;
        let frameCount = 0;
        flipCount = 0;
        
        // 获取音符时间点
        const noteTimes = track.notes.map(note => note.time);
        const maxNoteTime = Math.max(...noteTimes);
        const timeScale = duration / maxNoteTime;
        const scaledNoteTimes = noteTimes.map(time => time * timeScale);
        
        let flipped = false;
        
        function generateNextFrame() {
            if (!isGenerating || frameCount >= totalFrames) {
                mediaRecorder.stop();
                return;
            }
            
            const currentTime = frameCount / fps;
            
            // 检查是否有音符在这个时间点
            const noteIndex = scaledNoteTimes.findIndex(time => 
                Math.abs(time - currentTime) < (0.5 / fps)
            );
            
            if (noteIndex !== -1 && noteIndex % 2 === 0) {
                // 每两个音符翻转一次
                flipped = !flipped;
                flipCount++;
            }
            
            // 绘制当前帧到离屏Canvas
            drawImageToOffscreenCanvas(flipped, offscreenCtx, offscreenCanvas.width, offscreenCanvas.height);
            
            // 更新进度
            const progress = (frameCount / totalFrames) * 100;
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `生成帧: ${frameCount}/${totalFrames} (${flipCount}次翻转)`;
            
            frameCount++;
            
            // 控制生成速度
            setTimeout(generateNextFrame, 1000 / fps);
        }
        
        // 开始生成帧
        generateNextFrame();
        
    } catch (error) {
        console.error('视频生成错误:', error);
        statusElement.textContent = `视频生成失败: ${error.message}`;
        isGenerating = false;
        updateButtonStates();
        progressContainer.style.display = 'none';
    }
}

// 下载视频
function downloadVideo() {
    const videoUrl = outputVideo.dataset.videoUrl;
    if (!videoUrl) {
        alert('请先生成视频');
        return;
    }
    
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `midi-mirror-video-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// 获取支持的MIME类型
function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
    ];
    
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    
    return null;
}

// 获取视频比特率
function getVideoBitrate() {
    const quality = document.querySelector('.quality-btn.active').dataset.quality;
    const resolution = resolutionSelect.value;
    
    // 根据质量和分辨率设置比特率
    const baseBitrates = {
        '720p': 2000000,  // 2 Mbps
        '1080p': 5000000, // 5 Mbps
        '2k': 10000000,   // 10 Mbps
        '4k': 20000000    // 20 Mbps
    };
    
    const qualityMultipliers = {
        'balanced': 1.0,
        'high': 1.5,
        'ultra': 2.0
    };
    
    const baseBitrate = baseBitrates[resolution] || 5000000;
    const multiplier = qualityMultipliers[quality] || 1.0;
    
    return Math.round(baseBitrate * multiplier);
}

// 停止所有操作
function stopAll() {
    console.log('停止所有操作');
    isPreviewing = false;
    isGenerating = false;
    
    // 恢复图片显示
    canvas.style.display = 'none';
    imageElement.style.display = 'block';
    
    // 隐藏进度条
    progressContainer.style.display = 'none';
    
    statusElement.textContent = '已停止所有操作';
    updateButtonStates();
}

// 更新按钮状态
function updateButtonStates() {
    const hasMidi = midiData !== null;
    const hasImage = imageElement.src && !imageElement.src.includes('data:image/svg+xml');
    const hasTrack = !isNaN(selectedTrack);
    
    previewBtn.disabled = !(hasMidi && hasImage && hasTrack) || isGenerating;
    generateBtn.disabled = !(hasMidi && hasImage && hasTrack) || isPreviewing;
    stopBtn.disabled = !isPreviewing && !isGenerating;
}

// 辅助函数：格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}