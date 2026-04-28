// i18n — 언어 자동 감지 + 사용자 선택. 최소 스캐폴딩 (가시 UI 우선).
// 지원: en (영어, default fallback), ko (한국어), ja (일본어), es (스페인어), de (독일어), fr (프랑스어)
// data-i18n="key" 속성 → 자동 변환. window.t(key, fallback) 직접 호출도 가능.
// 컴퓨터 언어 자동 감지 + Settings 에서 수동 override.

(function(){
  'use strict';

  const TRANSLATIONS = {
    en: {
      tab_link: 'TCNet', tab_pdjl: 'Pro DJ Link', tab_artnet: 'Art-Net',
      tab_mixer: 'Mixer', tab_settings: 'Settings', tab_info: 'Info',
      mode_virtual: 'VIRTUAL', mode_hardware: 'HARDWARE',
      btn_cue: 'CUE', btn_play: 'PLAY', btn_stop: 'STOP',
      btn_master: 'MASTER', btn_sync: 'SYNC', btn_eject: 'EJECT',
      btn_start: 'START', btn_stop_engine: 'STOP', btn_refresh: 'Refresh',
      btn_activate: 'Activate', btn_deactivate: 'Deactivate',
      lbl_transport: 'TRANSPORT', lbl_smpte: 'SMPTE',
      lbl_bpm: 'BPM', lbl_key: 'KEY',
      lbl_status: 'Status', lbl_message: 'Message',
      lbl_no_track: 'NO TRACK', lbl_virtual: 'VIRTUAL',
      lbl_player: 'PLAYER', lbl_empty: 'EMPTY',
      lbl_click_to_open: 'Click to open',
      lbl_remove_deck: 'Remove deck',
      lbl_empty_deck: 'Empty deck',
      lbl_no_djm: 'DJM not connected',
      lbl_djm_disconnected: 'DJM mixer is not connected',
      lbl_djm_hint: 'Connect a DJM to the Pro DJ Link network to see real-time mixer data',
      lbl_hw_hint: 'Auto-detected when CDJ connects',
      lbl_vt_hint: 'Click + to add a deck and load files',
      lbl_realtime_hw: 'Real-time data shown when hardware connects',
      add_deck: 'Add Virtual Deck', add_deck_max: '(max 6)',
      lbl_language: 'Language', lbl_layout: 'Layout', lbl_theme: 'Theme',
      lbl_layout_section: 'Deck Layout', lbl_layout_theme: 'Layout Theme',
      lbl_waveform: 'Waveform Settings',
      sb_decks: 'DECKS', sb_mixer: 'MIXER', sb_history: 'HIST',
      sb_pdjl: 'PDJL', sb_tcnet: 'TCNET', sb_artnet: 'ARTNET',
      sb_link: 'LINK', sb_settings: 'SET',
      set_deck_layout: 'Deck Layout', set_layout_theme: 'Layout Theme',
      set_waveform: 'Waveform Settings', set_license: 'License',
      set_tcnet: 'TCNet Settings', set_pdjl: 'Pro DJ Link Settings',
      set_audio_out: 'Audio Output', set_smpte: 'SMPTE Timecode Output',
      lbl_sharpness: 'Sharpness', lbl_playhead_pos: 'Playhead position',
      lbl_position_center: 'Center', lbl_position_left: 'Left (25%)',
      lbl_settings_general: 'General', lbl_settings_audio: 'Audio',
      lbl_settings_network: 'Network', lbl_settings_waveform: 'Waveform',
      lbl_settings_license: 'License',
      lbl_email: 'Email', lbl_serial: 'Serial Code',
      lbl_management: 'Management',
      lbl_node_name: 'Node Name', lbl_frame_rate: 'Frame Rate',
      lbl_tcnet_iface: 'TCNet Interface', lbl_tcnet_mode: 'TCNet Mode',
      lbl_pdjl_iface: 'Pro DJ Link Interface', lbl_iface_list: 'Interface List',
      lbl_pdjl_settings: 'Pro DJ Link Settings', lbl_tcnet_settings: 'TCNet Settings',
      lbl_auto: 'Auto', lbl_auto_detect: 'Auto-detect',
      lbl_server: 'Server', lbl_client: 'Client',
      lbl_input_layers_hw: 'INPUT LAYERS — CDJ / HW',
      lbl_input_layers_virtual: 'INPUT LAYERS — VIRTUAL',
      lbl_deck_mode: 'DECK MODE',
      lbl_remove: 'Remove', lbl_eject: 'Eject',
      lbl_loading: 'Loading...', lbl_press_start: 'Press START to begin TCNet',
      lbl_drag_drop: 'Drag & drop audio file here',
    },
    ko: {
      tab_link: 'TCNet', tab_pdjl: 'Pro DJ Link', tab_artnet: 'Art-Net',
      tab_mixer: '믹서', tab_settings: '설정', tab_info: '정보',
      mode_virtual: 'VIRTUAL', mode_hardware: 'HARDWARE',
      btn_cue: 'CUE', btn_play: 'PLAY', btn_stop: 'STOP',
      btn_master: 'MASTER', btn_sync: 'SYNC', btn_eject: '꺼내기',
      btn_start: 'START', btn_stop_engine: 'STOP', btn_refresh: '새로고침',
      btn_activate: '활성화', btn_deactivate: '비활성화',
      lbl_transport: 'TRANSPORT', lbl_smpte: 'SMPTE',
      lbl_bpm: 'BPM', lbl_key: 'KEY',
      lbl_status: '상태', lbl_message: '메시지',
      lbl_no_track: '트랙 없음', lbl_virtual: 'VIRTUAL',
      lbl_player: 'PLAYER', lbl_empty: '비어있음',
      lbl_click_to_open: '클릭하여 열기',
      lbl_remove_deck: '덱 삭제',
      lbl_empty_deck: '빈 덱',
      lbl_no_djm: 'DJM 미연결',
      lbl_djm_disconnected: 'DJM 믹서가 연결되지 않았습니다',
      lbl_djm_hint: 'Pro DJ Link 네트워크에 DJM을 연결하면 실시간 믹서 데이터가 표시됩니다',
      lbl_hw_hint: 'CDJ 연결 시 자동 감지됩니다',
      lbl_vt_hint: '+ 버튼으로 덱 추가 후 파일 로드',
      lbl_realtime_hw: '하드웨어 연결 시 실시간 데이터 표시',
      add_deck: 'Virtual 덱 추가', add_deck_max: '(최대 6개)',
      lbl_language: '언어', lbl_layout: '레이아웃', lbl_theme: '테마',
      lbl_layout_section: '덱 레이아웃', lbl_layout_theme: '레이아웃 테마',
      lbl_waveform: '웨이브폼 설정',
      sb_decks: '덱', sb_mixer: '믹서', sb_history: '기록',
      sb_pdjl: 'PDJL', sb_tcnet: 'TCNET', sb_artnet: 'ARTNET',
      sb_link: '링크', sb_settings: '설정',
      set_deck_layout: '덱 레이아웃', set_layout_theme: '레이아웃 테마',
      set_waveform: '웨이브폼 설정', set_license: '라이선스',
      set_tcnet: 'TCNet 설정', set_pdjl: 'Pro DJ Link 설정',
      set_audio_out: '오디오 출력', set_smpte: 'SMPTE 타임코드 출력',
      lbl_sharpness: '선명도', lbl_playhead_pos: '플레이헤드 위치',
      lbl_position_center: '중앙 (Center)', lbl_position_left: '좌측 (Left 25%)',
      lbl_settings_general: '일반', lbl_settings_audio: '오디오',
      lbl_settings_network: '네트워크', lbl_settings_waveform: '웨이브폼',
      lbl_settings_license: '라이선스',
      lbl_email: '이메일', lbl_serial: '시리얼 코드',
      lbl_management: '관리',
      lbl_node_name: '노드 이름', lbl_frame_rate: '프레임 레이트',
      lbl_tcnet_iface: 'TCNet 인터페이스', lbl_tcnet_mode: 'TCNet 모드',
      lbl_pdjl_iface: 'Pro DJ Link 인터페이스', lbl_iface_list: '인터페이스 목록',
      lbl_pdjl_settings: 'Pro DJ Link 설정', lbl_tcnet_settings: 'TCNet 설정',
      lbl_auto: '자동', lbl_auto_detect: '자동 감지',
      lbl_server: '서버', lbl_client: '클라이언트',
      lbl_input_layers_hw: '입력 레이어 — CDJ / 하드웨어',
      lbl_input_layers_virtual: '입력 레이어 — VIRTUAL',
      lbl_deck_mode: '덱 모드',
      lbl_remove: '제거', lbl_eject: '꺼내기',
      lbl_loading: '로딩 중...', lbl_press_start: 'START를 눌러 TCNet을 시작하세요',
      lbl_drag_drop: '오디오 파일을 여기에 드래그하세요',
    },
    ja: {
      tab_link: 'TCNet', tab_pdjl: 'Pro DJ Link', tab_artnet: 'Art-Net',
      tab_mixer: 'ミキサー', tab_settings: '設定', tab_info: '情報',
      mode_virtual: 'VIRTUAL', mode_hardware: 'HARDWARE',
      btn_cue: 'CUE', btn_play: 'PLAY', btn_stop: 'STOP',
      btn_master: 'MASTER', btn_sync: 'SYNC', btn_eject: '取り出し',
      btn_start: 'START', btn_stop_engine: 'STOP', btn_refresh: '更新',
      btn_activate: '有効化', btn_deactivate: '無効化',
      lbl_transport: 'TRANSPORT', lbl_smpte: 'SMPTE',
      lbl_bpm: 'BPM', lbl_key: 'KEY',
      lbl_status: 'ステータス', lbl_message: 'メッセージ',
      lbl_no_track: 'トラックなし', lbl_virtual: 'VIRTUAL',
      lbl_player: 'PLAYER', lbl_empty: '空',
      lbl_click_to_open: 'クリックして開く',
      lbl_remove_deck: 'デッキを削除',
      lbl_empty_deck: '空のデッキ',
      lbl_no_djm: 'DJM未接続',
      lbl_djm_disconnected: 'DJMミキサーが接続されていません',
      lbl_djm_hint: 'Pro DJ LinkネットワークにDJMを接続するとリアルタイムデータが表示されます',
      lbl_hw_hint: 'CDJ接続時に自動検出されます',
      lbl_vt_hint: '+ボタンでデッキを追加してファイルをロード',
      lbl_realtime_hw: 'ハードウェア接続時にリアルタイムデータを表示',
      add_deck: 'Virtualデッキ追加', add_deck_max: '(最大6台)',
      lbl_language: '言語', lbl_layout: 'レイアウト', lbl_theme: 'テーマ',
      lbl_layout_section: 'デッキレイアウト', lbl_layout_theme: 'レイアウトテーマ',
      lbl_waveform: '波形設定',
      lbl_sharpness: 'シャープネス', lbl_playhead_pos: '再生ヘッド位置',
      lbl_position_center: '中央 (Center)', lbl_position_left: '左 (Left 25%)',
      lbl_settings_general: '一般', lbl_settings_audio: 'オーディオ',
      lbl_settings_network: 'ネットワーク', lbl_settings_waveform: '波形',
      lbl_settings_license: 'ライセンス',
      lbl_email: 'メール', lbl_serial: 'シリアルコード',
      lbl_management: '管理',
      lbl_node_name: 'ノード名', lbl_frame_rate: 'フレームレート',
      lbl_tcnet_iface: 'TCNetインターフェース', lbl_tcnet_mode: 'TCNetモード',
      lbl_pdjl_iface: 'Pro DJ Linkインターフェース', lbl_iface_list: 'インターフェース一覧',
      lbl_pdjl_settings: 'Pro DJ Link設定', lbl_tcnet_settings: 'TCNet設定',
      lbl_auto: '自動', lbl_auto_detect: '自動検出',
      lbl_server: 'サーバー', lbl_client: 'クライアント',
      lbl_input_layers_hw: '入力レイヤー — CDJ / ハードウェア',
      lbl_input_layers_virtual: '入力レイヤー — VIRTUAL',
      lbl_deck_mode: 'デッキモード',
      lbl_remove: '削除', lbl_eject: '取り出し',
      lbl_loading: '読み込み中...', lbl_press_start: 'STARTを押してTCNetを開始',
      lbl_drag_drop: 'オーディオファイルをここにドラッグ',
    },
    es: {
      tab_link: 'TCNet', tab_pdjl: 'Pro DJ Link', tab_artnet: 'Art-Net',
      tab_mixer: 'Mezclador', tab_settings: 'Ajustes', tab_info: 'Info',
      mode_virtual: 'VIRTUAL', mode_hardware: 'HARDWARE',
      btn_cue: 'CUE', btn_play: 'PLAY', btn_stop: 'STOP',
      btn_master: 'MASTER', btn_sync: 'SYNC', btn_eject: 'Expulsar',
      btn_start: 'INICIAR', btn_stop_engine: 'PARAR', btn_refresh: 'Actualizar',
      btn_activate: 'Activar', btn_deactivate: 'Desactivar',
      lbl_transport: 'TRANSPORTE', lbl_smpte: 'SMPTE',
      lbl_bpm: 'BPM', lbl_key: 'TONO',
      lbl_status: 'Estado', lbl_message: 'Mensaje',
      lbl_no_track: 'SIN PISTA', lbl_virtual: 'VIRTUAL',
      lbl_player: 'REPRODUCTOR', lbl_empty: 'VACÍO',
      lbl_click_to_open: 'Clic para abrir',
      lbl_remove_deck: 'Eliminar deck',
      lbl_empty_deck: 'Deck vacío',
      lbl_no_djm: 'DJM no conectado',
      lbl_djm_disconnected: 'El mezclador DJM no está conectado',
      lbl_djm_hint: 'Conecta un DJM a la red Pro DJ Link para ver datos en tiempo real',
      lbl_hw_hint: 'Detección automática al conectar CDJ',
      lbl_vt_hint: 'Pulsa + para añadir un deck y cargar archivos',
      lbl_realtime_hw: 'Datos en tiempo real al conectar hardware',
      add_deck: 'Añadir Deck Virtual', add_deck_max: '(máx. 6)',
      lbl_language: 'Idioma', lbl_layout: 'Diseño', lbl_theme: 'Tema',
      lbl_layout_section: 'Diseño de Decks', lbl_layout_theme: 'Tema de Diseño',
      lbl_waveform: 'Ajustes de forma de onda',
      lbl_sharpness: 'Nitidez', lbl_playhead_pos: 'Posición del cabezal',
      lbl_position_center: 'Centro (Center)', lbl_position_left: 'Izquierda (Left 25%)',
      lbl_settings_general: 'General', lbl_settings_audio: 'Audio',
      lbl_settings_network: 'Red', lbl_settings_waveform: 'Forma de onda',
      lbl_settings_license: 'Licencia',
      lbl_email: 'Correo', lbl_serial: 'Código de serie',
      lbl_management: 'Gestión',
      lbl_node_name: 'Nombre de nodo', lbl_frame_rate: 'Frecuencia',
      lbl_tcnet_iface: 'Interfaz TCNet', lbl_tcnet_mode: 'Modo TCNet',
      lbl_pdjl_iface: 'Interfaz Pro DJ Link', lbl_iface_list: 'Lista de interfaces',
      lbl_pdjl_settings: 'Ajustes Pro DJ Link', lbl_tcnet_settings: 'Ajustes TCNet',
      lbl_auto: 'Auto', lbl_auto_detect: 'Detección automática',
      lbl_server: 'Servidor', lbl_client: 'Cliente',
      lbl_input_layers_hw: 'CAPAS DE ENTRADA — CDJ / HW',
      lbl_input_layers_virtual: 'CAPAS DE ENTRADA — VIRTUAL',
      lbl_deck_mode: 'MODO DECK',
      lbl_remove: 'Eliminar', lbl_eject: 'Expulsar',
      lbl_loading: 'Cargando...', lbl_press_start: 'Pulsa INICIAR para comenzar TCNet',
      lbl_drag_drop: 'Arrastra el archivo de audio aquí',
    },
    de: {
      tab_link: 'TCNet', tab_pdjl: 'Pro DJ Link', tab_artnet: 'Art-Net',
      tab_mixer: 'Mixer', tab_settings: 'Einstellungen', tab_info: 'Info',
      mode_virtual: 'VIRTUELL', mode_hardware: 'HARDWARE',
      btn_cue: 'CUE', btn_play: 'PLAY', btn_stop: 'STOP',
      btn_master: 'MASTER', btn_sync: 'SYNC', btn_eject: 'Auswerfen',
      btn_start: 'START', btn_stop_engine: 'STOP', btn_refresh: 'Aktualisieren',
      btn_activate: 'Aktivieren', btn_deactivate: 'Deaktivieren',
      lbl_transport: 'TRANSPORT', lbl_smpte: 'SMPTE',
      lbl_bpm: 'BPM', lbl_key: 'TONART',
      lbl_status: 'Status', lbl_message: 'Nachricht',
      lbl_no_track: 'KEIN TRACK', lbl_virtual: 'VIRTUELL',
      lbl_player: 'PLAYER', lbl_empty: 'LEER',
      lbl_click_to_open: 'Klicken zum Öffnen',
      lbl_remove_deck: 'Deck entfernen',
      lbl_empty_deck: 'Leerer Deck',
      lbl_no_djm: 'DJM nicht verbunden',
      lbl_djm_disconnected: 'DJM-Mixer ist nicht verbunden',
      lbl_djm_hint: 'DJM mit Pro DJ Link Netzwerk verbinden für Echtzeit-Daten',
      lbl_hw_hint: 'Automatische Erkennung bei CDJ-Verbindung',
      lbl_vt_hint: '+ klicken um Deck hinzuzufügen und Datei zu laden',
      lbl_realtime_hw: 'Echtzeit-Daten bei Hardware-Verbindung',
      add_deck: 'Virtuellen Deck hinzufügen', add_deck_max: '(max. 6)',
      lbl_language: 'Sprache', lbl_layout: 'Layout', lbl_theme: 'Thema',
      lbl_layout_section: 'Deck-Layout', lbl_layout_theme: 'Layout-Thema',
      lbl_waveform: 'Wellenform-Einstellungen',
      lbl_sharpness: 'Schärfe', lbl_playhead_pos: 'Wiedergabekopf-Position',
      lbl_position_center: 'Mitte (Center)', lbl_position_left: 'Links (Left 25%)',
      lbl_settings_general: 'Allgemein', lbl_settings_audio: 'Audio',
      lbl_settings_network: 'Netzwerk', lbl_settings_waveform: 'Wellenform',
      lbl_settings_license: 'Lizenz',
      lbl_email: 'E-Mail', lbl_serial: 'Seriencode',
      lbl_management: 'Verwaltung',
      lbl_node_name: 'Knotenname', lbl_frame_rate: 'Bildrate',
      lbl_tcnet_iface: 'TCNet-Schnittstelle', lbl_tcnet_mode: 'TCNet-Modus',
      lbl_pdjl_iface: 'Pro DJ Link Schnittstelle', lbl_iface_list: 'Schnittstellenliste',
      lbl_pdjl_settings: 'Pro DJ Link Einstellungen', lbl_tcnet_settings: 'TCNet-Einstellungen',
      lbl_auto: 'Auto', lbl_auto_detect: 'Automatische Erkennung',
      lbl_server: 'Server', lbl_client: 'Client',
      lbl_input_layers_hw: 'EINGABE-LAYER — CDJ / HW',
      lbl_input_layers_virtual: 'EINGABE-LAYER — VIRTUELL',
      lbl_deck_mode: 'DECK-MODUS',
      lbl_remove: 'Entfernen', lbl_eject: 'Auswerfen',
      lbl_loading: 'Laden...', lbl_press_start: 'START drücken um TCNet zu starten',
      lbl_drag_drop: 'Audio-Datei hier ablegen',
    },
    fr: {
      tab_link: 'TCNet', tab_pdjl: 'Pro DJ Link', tab_artnet: 'Art-Net',
      tab_mixer: 'Mixeur', tab_settings: 'Paramètres', tab_info: 'Info',
      mode_virtual: 'VIRTUEL', mode_hardware: 'MATÉRIEL',
      btn_cue: 'CUE', btn_play: 'PLAY', btn_stop: 'STOP',
      btn_master: 'MASTER', btn_sync: 'SYNC', btn_eject: 'Éjecter',
      btn_start: 'DÉMARRER', btn_stop_engine: 'ARRÊTER', btn_refresh: 'Actualiser',
      btn_activate: 'Activer', btn_deactivate: 'Désactiver',
      lbl_transport: 'TRANSPORT', lbl_smpte: 'SMPTE',
      lbl_bpm: 'BPM', lbl_key: 'CLÉ',
      lbl_status: 'État', lbl_message: 'Message',
      lbl_no_track: 'AUCUNE PISTE', lbl_virtual: 'VIRTUEL',
      lbl_player: 'LECTEUR', lbl_empty: 'VIDE',
      lbl_click_to_open: 'Cliquer pour ouvrir',
      lbl_remove_deck: 'Supprimer le deck',
      lbl_empty_deck: 'Deck vide',
      lbl_no_djm: 'DJM non connecté',
      lbl_djm_disconnected: "Le mixeur DJM n'est pas connecté",
      lbl_djm_hint: 'Connectez un DJM au réseau Pro DJ Link pour les données en temps réel',
      lbl_hw_hint: 'Détection automatique à la connexion du CDJ',
      lbl_vt_hint: 'Cliquez sur + pour ajouter un deck et charger des fichiers',
      lbl_realtime_hw: 'Données en temps réel à la connexion du matériel',
      add_deck: 'Ajouter un Deck Virtuel', add_deck_max: '(max. 6)',
      lbl_language: 'Langue', lbl_layout: 'Disposition', lbl_theme: 'Thème',
      lbl_layout_section: 'Disposition des Decks', lbl_layout_theme: 'Thème de Disposition',
      lbl_waveform: "Paramètres de forme d'onde",
      lbl_sharpness: 'Netteté', lbl_playhead_pos: 'Position de la tête',
      lbl_position_center: 'Centre (Center)', lbl_position_left: 'Gauche (Left 25%)',
      lbl_settings_general: 'Général', lbl_settings_audio: 'Audio',
      lbl_settings_network: 'Réseau', lbl_settings_waveform: "Forme d'onde",
      lbl_settings_license: 'Licence',
      lbl_email: 'E-mail', lbl_serial: 'Code de série',
      lbl_management: 'Gestion',
      lbl_node_name: 'Nom du nœud', lbl_frame_rate: "Fréquence d'image",
      lbl_tcnet_iface: 'Interface TCNet', lbl_tcnet_mode: 'Mode TCNet',
      lbl_pdjl_iface: 'Interface Pro DJ Link', lbl_iface_list: "Liste d'interfaces",
      lbl_pdjl_settings: 'Paramètres Pro DJ Link', lbl_tcnet_settings: 'Paramètres TCNet',
      lbl_auto: 'Auto', lbl_auto_detect: 'Détection automatique',
      lbl_server: 'Serveur', lbl_client: 'Client',
      lbl_input_layers_hw: "COUCHES D'ENTRÉE — CDJ / HW",
      lbl_input_layers_virtual: "COUCHES D'ENTRÉE — VIRTUEL",
      lbl_deck_mode: 'MODE DECK',
      lbl_remove: 'Supprimer', lbl_eject: 'Éjecter',
      lbl_loading: 'Chargement...', lbl_press_start: 'Appuyez sur DÉMARRER pour TCNet',
      lbl_drag_drop: 'Glissez le fichier audio ici',
    },
  };

  const SUPPORTED = Object.keys(TRANSLATIONS);
  const DEFAULT_LANG = 'en';

  function detectSystemLang(){
    const raw = (navigator.language || navigator.userLanguage || DEFAULT_LANG).toLowerCase();
    const base = raw.split('-')[0];
    return SUPPORTED.includes(base) ? base : DEFAULT_LANG;
  }

  function loadSavedLang(){
    try {
      const saved = localStorage.getItem('bridge_lang');
      if (saved === 'auto' || !saved) return null; // null = auto
      return SUPPORTED.includes(saved) ? saved : null;
    } catch(_) { return null; }
  }

  let currentLang = loadSavedLang() || detectSystemLang();

  function t(key, fallback){
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS[DEFAULT_LANG];
    return (dict && dict[key]) || fallback || key;
  }

  function applyDom(root){
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key, el.textContent);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = val;
      } else {
        el.textContent = val;
      }
    });
    document.body.dataset.lang = currentLang;
  }

  function setLang(lang){
    if (lang === 'auto'){
      try { localStorage.setItem('bridge_lang', 'auto'); } catch(_) {}
      currentLang = detectSystemLang();
    } else if (SUPPORTED.includes(lang)) {
      try { localStorage.setItem('bridge_lang', lang); } catch(_) {}
      currentLang = lang;
    } else {
      return;
    }
    applyDom();
    // 동적으로 빌드되는 컴포넌트 재렌더 트리거
    try { window.dispatchEvent(new CustomEvent('i18n-changed', { detail: { lang: currentLang } })); } catch(_) {}
  }

  function getLang(){ return currentLang; }
  function getSavedPref(){
    try { return localStorage.getItem('bridge_lang') || 'auto'; } catch(_) { return 'auto'; }
  }

  window.t = t;
  window.BridgeI18n = {
    t, applyDom, setLang, getLang, getSavedPref,
    supported: SUPPORTED,
    languageNames: { en: 'English', ko: '한국어', ja: '日本語', es: 'Español', de: 'Deutsch', fr: 'Français' },
  };

  // 초기 적용 — DOM 준비 시 한 번
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDom());
  } else {
    applyDom();
  }
})();
