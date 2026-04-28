// HTML escape utility — XSS 방지용 (Phase 4.17 security).
// PDJL/TCNet 패킷에서 받은 device name/ip 같은 외부 신뢰 불가 데이터를
// innerHTML template literal 에 삽입할 때 반드시 _escHtml() 통해야 함.
// 글로벌 lexical env 호환 — script-top-level 로딩.

const _ESC_MAP = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' };

function _escHtml(s){
  if (s == null) return '';
  return String(s).replace(/[<>"'&]/g, c => _ESC_MAP[c]);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _escHtml };
}
