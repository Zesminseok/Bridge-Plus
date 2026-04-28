// ID3 tag parser — text/TXXX/BPM frame decoding (Phase 4.13 modularization).
// renderer/index.html 인라인 스크립트에서 추출. Pure functions — global state 없음.
// 글로벌 lexical env 호환 — script-top-level 로딩으로 _id3* 이름 그대로 참조 가능.

function _id3DecodeText(fdata){
  const enc=fdata[0];let txt='';
  if(enc===0){for(let i=1;i<fdata.length;i++){if(fdata[i]===0)break;txt+=String.fromCharCode(fdata[i]);}}
  else if(enc===1){let s=1,le=true;if(fdata.length>2&&fdata[1]===0xFF&&fdata[2]===0xFE){le=true;s=3;}else if(fdata.length>2&&fdata[1]===0xFE&&fdata[2]===0xFF){le=false;s=3;}for(let i=s;i+1<fdata.length;i+=2){const c=le?(fdata[i]|fdata[i+1]<<8):(fdata[i]<<8|fdata[i+1]);if(c===0)break;txt+=String.fromCharCode(c);}}
  else if(enc===2){for(let i=1;i+1<fdata.length;i+=2){const c=(fdata[i]<<8|fdata[i+1]);if(c===0)break;txt+=String.fromCharCode(c);}}
  else if(enc===3){txt=new TextDecoder('utf-8').decode(fdata.slice(1));const ni=txt.indexOf('\0');if(ni>=0)txt=txt.slice(0,ni);}
  return txt.trim();
}

function _id3ParseBpm(txt){
  const m=String(txt||'').replace(',','.').match(/\d+(?:\.\d+)?/);
  const b=m?parseFloat(m[0]):0;
  return b>20&&b<300?b:0;
}

function _id3DecodeTxxx(fdata){
  const enc=fdata[0];let cut=-1,step=(enc===1||enc===2)?2:1;
  if(step===1){for(let i=1;i<fdata.length;i++){if(fdata[i]===0){cut=i;break;}}}
  else{for(let i=1;i+1<fdata.length;i+=2){if(fdata[i]===0&&fdata[i+1]===0){cut=i;break;}}}
  if(cut<0)return{desc:_id3DecodeText(fdata),value:''};
  const desc=_id3DecodeText(new Uint8Array([enc,...fdata.slice(1,cut)]));
  const value=_id3DecodeText(new Uint8Array([enc,...fdata.slice(cut+step)]));
  return{desc,value};
}

function _id3ApplyTextFrame(tags,fid,fdata){
  const txt=_id3DecodeText(fdata);
  if(fid==='TIT2'&&txt)tags.title=txt;
  if(fid==='TPE1'&&txt)tags.artist=txt;
  if(fid==='TPE2'&&txt&&!tags.artist)tags.artist=txt;
  if(fid==='TKEY'&&txt)tags.key=txt;
  if(fid==='TBPM'&&txt){const b=_id3ParseBpm(txt);if(b>0){tags.bpm=b;tags.bpmSource='TBPM';}}
  if(fid==='TXXX'&&!tags.bpm){
    const txxx=_id3DecodeTxxx(fdata);
    const desc=String(txxx.desc||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    if(desc==='bpm'||desc==='tempo'||desc==='trackbpm'){
      const b=_id3ParseBpm(txxx.value);
      if(b>0){tags.bpm=b;tags.bpmSource='TXXX:'+txxx.desc;}
    }
  }
}

// AIFF: ID3 tag 가 'ID3 ' chunk 안에 위치 (대용량 SSND 뒤에 올 수 있음 → 전체 chunk 스캔).
async function _findAIFFId3(file){
  const hdr=new DataView(await file.slice(0,12).arrayBuffer());
  if(hdr.getUint32(0,false)!==0x464F524D)return -1;
  const ft=String.fromCharCode(hdr.getUint8(8),hdr.getUint8(9),hdr.getUint8(10),hdr.getUint8(11));
  if(ft!=='AIFF'&&ft!=='AIFC')return -1;
  let pos=12;
  while(pos+8<=file.size){
    const h=new DataView(await file.slice(pos,pos+8).arrayBuffer());
    const id=String.fromCharCode(h.getUint8(0),h.getUint8(1),h.getUint8(2),h.getUint8(3));
    const sz=h.getUint32(4,false);
    if(!id.trim()||sz>file.size)break;
    if(id==='ID3 '||id==='id3 ')return pos+8;
    pos+=8+sz+(sz&1);if(sz===0)break;
  }
  return -1;
}

// readID3Tags — 파일에서 ID3v2 tag 읽어 metadata + album art 추출 (browser-only).
async function readID3Tags(file){
  const tags={title:'',artist:'',art:null,key:'',bpm:0,bpmSource:''};
  try{
    const buf=await file.slice(0,Math.min(file.size,524288)).arrayBuffer();
    const view=new DataView(buf);
    let id3Start=0;
    // AIFF: ID3v2 lives inside an 'ID3 ' chunk (may be at end of file)
    if(view.getUint32(0,false)===0x464F524D){ // "FORM"
      const formType=String.fromCharCode(view.getUint8(8),view.getUint8(9),view.getUint8(10),view.getUint8(11));
      if(formType==='AIFF'||formType==='AIFC'){
        // scan all chunks — ID3 tag may appear after the large SSND chunk
        const id3Off=await _findAIFFId3(file);
        if(id3Off<0)return tags;
        const id3Buf=await file.slice(id3Off,id3Off+524288).arrayBuffer();
        const id3V=new DataView(id3Buf);
        if(id3V.getUint8(0)!==0x49||id3V.getUint8(1)!==0x44||id3V.getUint8(2)!==0x33)return tags;
        const id3ver=id3V.getUint8(3);
        const id3sz=(id3V.getUint8(6)&0x7F)<<21|(id3V.getUint8(7)&0x7F)<<14|(id3V.getUint8(8)&0x7F)<<7|(id3V.getUint8(9)&0x7F);
        let ip=10;const ie=Math.min(10+id3sz,id3Buf.byteLength);
        while(ip+10<ie){
          const fid=String.fromCharCode(id3V.getUint8(ip),id3V.getUint8(ip+1),id3V.getUint8(ip+2),id3V.getUint8(ip+3));
          if(fid[0]==='\0')break;
          let fsz=id3ver===4?(id3V.getUint8(ip+4)&0x7F)<<21|(id3V.getUint8(ip+5)&0x7F)<<14|(id3V.getUint8(ip+6)&0x7F)<<7|(id3V.getUint8(ip+7)&0x7F):id3V.getUint32(ip+4,false);
          if(fsz<=0||ip+10+fsz>ie)break;
          const fdata=new Uint8Array(id3Buf,ip+10,fsz);
          if(fid==='TIT2'||fid==='TPE1'||fid==='TPE2'||fid==='TKEY'||fid==='TBPM'||fid==='TXXX')_id3ApplyTextFrame(tags,fid,fdata);
          if(fid==='APIC'&&!tags.art){try{const enc=fdata[0];let o=1;let mime='';while(o<fdata.length&&fdata[o]!==0){mime+=String.fromCharCode(fdata[o]);o++;}o++;o++;if(enc===0||enc===3){while(o<fdata.length&&fdata[o]!==0)o++;o++;}else{while(o+1<fdata.length){if(fdata[o]===0&&fdata[o+1]===0){o+=2;break;}o+=2;}}if(o<fdata.length){const imgData=fdata.slice(o);if(!mime||mime==='image/')mime=imgData[0]===0x89?'image/png':'image/jpeg';const blob=new Blob([imgData],{type:mime});tags.art=URL.createObjectURL(blob);tags._artRaw=imgData;}}catch(_){}}
          ip+=10+fsz;
        }
        return tags;
      }
    }
    // ID3v2 header check: "ID3"
    if(view.getUint8(id3Start)!==0x49||view.getUint8(id3Start+1)!==0x44||view.getUint8(id3Start+2)!==0x33) return tags;
    const ver=view.getUint8(id3Start+3);
    const sz=(view.getUint8(id3Start+6)&0x7F)<<21|(view.getUint8(id3Start+7)&0x7F)<<14|(view.getUint8(id3Start+8)&0x7F)<<7|(view.getUint8(id3Start+9)&0x7F);
    let pos=id3Start+10;
    const end=Math.min(id3Start+10+sz,buf.byteLength);
    while(pos+10<end){
      const fid=String.fromCharCode(view.getUint8(pos),view.getUint8(pos+1),view.getUint8(pos+2),view.getUint8(pos+3));
      if(fid[0]==='\0') break;
      let fsz;
      if(ver===4) fsz=(view.getUint8(pos+4)&0x7F)<<21|(view.getUint8(pos+5)&0x7F)<<14|(view.getUint8(pos+6)&0x7F)<<7|(view.getUint8(pos+7)&0x7F);
      else fsz=view.getUint32(pos+4);
      if(fsz<=0||pos+10+fsz>end) break;
      const fdata=new Uint8Array(buf,pos+10,fsz);
      if(fid==='TIT2'||fid==='TPE1'||fid==='TPE2'||fid==='TKEY'||fid==='TBPM'||fid==='TXXX')_id3ApplyTextFrame(tags,fid,fdata);
      // APIC: album art (front cover preferred)
      if(fid==='APIC'&&!tags.art){
        try{
          const enc=fdata[0];let o=1;
          let mime='';while(o<fdata.length&&fdata[o]!==0){mime+=String.fromCharCode(fdata[o]);o++;}o++; // null-terminate
          const picType=fdata[o];o++;
          // skip description string
          if(enc===0||enc===3){while(o<fdata.length&&fdata[o]!==0)o++;o++;}
          else{while(o+1<fdata.length){if(fdata[o]===0&&fdata[o+1]===0){o+=2;break;}o+=2;}}
          if(o<fdata.length){
            const imgData=fdata.slice(o);
            // Detect MIME by magic bytes (more reliable than APIC mime string)
            if(imgData[0]===0xFF&&imgData[1]===0xD8) mime='image/jpeg';
            else if(imgData[0]===0x89&&imgData[1]===0x50) mime='image/png';
            else if(imgData[0]===0x47&&imgData[1]===0x49) mime='image/gif';
            else if(!mime||!mime.startsWith('image/')) mime='image/jpeg';
            console.log(`[ID3 APIC] enc=${enc} picType=${picType} mime=${mime} size=${imgData.length} magic=0x${imgData[0].toString(16)}${imgData[1].toString(16)}`);
            const blob=new Blob([imgData],{type:mime});
            tags.art=URL.createObjectURL(blob);
            tags._artRaw=imgData;  // keep raw bytes for virtual dbserver
          }else{console.warn('[ID3 APIC] no image data after header, o='+o+' fdata.length='+fdata.length);}
        }catch(e){console.warn('[ID3 APIC parse error]',e);}
      }
      pos+=10+fsz;
    }
  }catch(e){console.warn('ID3 parse error:',e);}
  return tags;
}

// Node test 환경 — module.exports (readID3Tags / _findAIFFId3 는 browser-only, export 하지만 호출 X).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _id3DecodeText, _id3ParseBpm, _id3DecodeTxxx, _id3ApplyTextFrame, _findAIFFId3, readID3Tags };
}
