// FFmpeg 오디오 디코드 IPC — main.js 에서 추출 (Phase 3.6 modularization).
// FFmpeg 검색 + decode + temp 파일 관리.

const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');
const { spawn }=require('child_process');

let _ffmpegPath=null;
function findFFmpeg(){
  if(_ffmpegPath!==null)return _ffmpegPath;
  const candidates=[
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    process.env.FFMPEG_PATH||'',
  ].filter(Boolean);
  for(const p of candidates){try{fs.accessSync(p,fs.constants.X_OK);_ffmpegPath=p;return p;}catch(_){}}
  try{const r=require('child_process').execSync('which ffmpeg 2>/dev/null',{encoding:'utf8',timeout:2000}).trim();if(r){_ffmpegPath=r;return r;}}catch(_){}
  _ffmpegPath='';return'';
}

// Temp 파일 레지스트리 (quit 시 cleanup)
const tempFiles=new Set();

function cleanupTempFiles(){
  for(const f of tempFiles){try{fs.unlinkSync(f);}catch(_){}}
  tempFiles.clear();
}

function registerAudioDecodeIpc(ipcMain, { getWin }){
  ipcMain.handle('bridge:checkFFmpeg',()=>{
    const p=findFFmpeg();return{available:!!p,path:p};
  });

  ipcMain.handle('bridge:decodeAudio',async(_,{filePath,slot})=>{
    // SECURITY: filePath validation — extension whitelist + symlink 거부 + realpath 검증.
    // (extension 만으론 ../ 또는 symlink 로 임의 파일 ffmpeg 입력 가능)
    if (typeof filePath !== 'string' || filePath.length > 4096) return { ok: false, err: 'invalid filePath' };
    if (typeof slot !== 'number' || slot < 0 || slot > 15) return { ok: false, err: 'invalid slot' };
    const _ext = path.extname(filePath).toLowerCase();
    const _ALLOWED = ['.mp3', '.m4a', '.wav', '.aiff', '.aif', '.aac', '.flac', '.ogg', '.opus', '.webm'];
    if (!_ALLOWED.includes(_ext)) return { ok: false, err: 'unsupported audio format: ' + _ext };
    // lstat: symlink 자체 거부 (대상이 audio 라도 실제 파일이 /etc/passwd 등으로 가리킬 수 있음).
    let _realPath;
    try {
      const _lst = fs.lstatSync(filePath);
      if (_lst.isSymbolicLink()) return { ok: false, err: 'symlink not allowed' };
      if (!_lst.isFile()) return { ok: false, err: 'not a regular file' };
      _realPath = fs.realpathSync(filePath);
      // realpath 결과의 extension 도 다시 확인 (방어 심층화).
      const _realExt = path.extname(_realPath).toLowerCase();
      if (!_ALLOWED.includes(_realExt)) return { ok: false, err: 'resolved path has unsupported format' };
    } catch (e) {
      return { ok: false, err: 'file access denied' };
    }
    const ffmpeg=findFFmpeg();
    if(!ffmpeg)return{ok:false,err:'FFmpeg를 찾을 수 없습니다.\nbrew install ffmpeg 로 설치하세요.'};
    const tmpOut=path.join(os.tmpdir(),`bridge_${crypto.randomBytes(6).toString('hex')}.wav`);
    tempFiles.add(tmpOut);
    return new Promise(resolve=>{
      let settled=false;
      const done=result=>{ if(settled)return; settled=true; resolve(result); };
      // realpath 사용 — symlink 우회 차단.
      const args=['-i',_realPath,'-vn','-acodec','pcm_s24le','-ar','48000','-y',tmpOut];
      const proc=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});
      let stderr='',durationSec=0;
      // ffmpeg stderr 무한 누적 방지 — 256KB 캡 (마지막 일부만 유지 → 에러 메시지에 충분).
      const _STDERR_MAX = 256 * 1024;
      proc.stderr.on('data',chunk=>{
        const txt=chunk.toString();
        stderr += txt;
        if (stderr.length > _STDERR_MAX) stderr = stderr.slice(-_STDERR_MAX);
        if(!durationSec){const m=stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
          if(m)durationSec=parseInt(m[1])*3600+parseInt(m[2])*60+parseFloat(m[3]);}
        const pm=txt.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
        if(pm&&durationSec>0){
          const cur=parseInt(pm[1])*3600+parseInt(pm[2])*60+parseFloat(pm[3]);
          const pct=Math.min(99,Math.round(cur/durationSec*100));
          const win=getWin?.();
          if(win&&!win.isDestroyed())win.webContents.send('bridge:audioProgress',{slot,pct});
        }
      });
      proc.on('error',e=>{tempFiles.delete(tmpOut);try{fs.unlinkSync(tmpOut);}catch(_){}done({ok:false,err:e.message});});
      proc.on('close',code=>{
        if(code!==0){tempFiles.delete(tmpOut);try{fs.unlinkSync(tmpOut);}catch(_){}done({ok:false,err:stderr.slice(-400)});return;}
        const win=getWin?.();
        if(win&&!win.isDestroyed())win.webContents.send('bridge:audioProgress',{slot,pct:100});
        done({ok:true,tempPath:tmpOut});
      });
    });
  });

  ipcMain.handle('bridge:cleanupTemp',(_,{tempPath})=>{
    if(tempPath&&tempFiles.has(tempPath)){try{fs.unlinkSync(tempPath);}catch(_){}finally{tempFiles.delete(tempPath);}}
    return{ok:true};
  });
}

module.exports={ findFFmpeg, tempFiles, cleanupTempFiles, registerAudioDecodeIpc };
