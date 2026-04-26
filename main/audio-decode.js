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
    const ffmpeg=findFFmpeg();
    if(!ffmpeg)return{ok:false,err:'FFmpeg를 찾을 수 없습니다.\nbrew install ffmpeg 로 설치하세요.'};
    const tmpOut=path.join(os.tmpdir(),`bridge_${crypto.randomBytes(6).toString('hex')}.wav`);
    tempFiles.add(tmpOut);
    return new Promise(resolve=>{
      let settled=false;
      const done=result=>{ if(settled)return; settled=true; resolve(result); };
      const args=['-i',filePath,'-vn','-acodec','pcm_s24le','-ar','48000','-y',tmpOut];
      const proc=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});
      let stderr='',durationSec=0;
      proc.stderr.on('data',chunk=>{
        const txt=chunk.toString();stderr+=txt;
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
