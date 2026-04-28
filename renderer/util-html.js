// HTML escape utility — XSS 방지용 (Phase 4.17 security).
// PDJL/TCNet 패킷에서 받은 device name/ip 같은 외부 신뢰 불가 데이터를
// innerHTML template literal 에 삽입할 때 반드시 _escHtml() 통해야 함.
// 글로벌 lexical env 호환 — script-top-level 로딩.

const _ESC_MAP = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' };

function _escHtml(s){
  if (s == null) return '';
  return String(s).replace(/[<>"'&]/g, c => _ESC_MAP[c]);
}

// Album art / image src 안전 처리 — data:image/{jpeg,png,webp,gif} / blob: / assets/ 만 허용.
// dbserver TCP 응답이 변조되거나 ID3 art 가 악성이어도 javascript: scheme 등 차단.
// 통과한 값은 _escHtml 로 quote attribute 탈출도 방지 (defense in depth).
function _safeImgSrc(s){
  if (s == null) return '';
  const v = String(s);
  if (/^data:image\/(jpeg|png|webp|gif);base64,/i.test(v)) return _escHtml(v);
  if (/^blob:/.test(v)) return _escHtml(v);
  if (/^assets\//.test(v)) return _escHtml(v);
  return 'assets/default-art.png';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _escHtml, _safeImgSrc };
}
