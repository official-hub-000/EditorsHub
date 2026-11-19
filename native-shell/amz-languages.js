/*
 * The five interface languages the editor does not carry.
 *
 * The homepage strings live in two globals: HOME_LANGUAGES (the picker entries) and
 * HOME_I18N (the translated strings). Both are ordinary bindings, so they can be extended
 * without touching the document.
 *
 * Everything here is translation of the seventeen homepage strings, which is the scope the
 * existing fourteen languages work to. Extending a language past that scope would mean
 * translating the editor's own labels, which the pipeline in tools/i18n does for the
 * languages it covers; the strings below are held to the same seventeen.
 */
(function () {
  'use strict';
  if (window.omsAmzLanguages) return;

  /* Each entry: picker row, then the seventeen strings in the established order. */
  var ADDITIONS = [
    {
      meta: { id: 'ko', code: '한국', name: '한국어', region: '대한민국', flag: '\uD83C\uDDF0\uD83C\uDDF7', locale: 'ko-KR' },
      strings: {
        import: '가져오기',
        workspace: '로컬 작업 공간',
        projects: '내 프로젝트',
        sort: '프로젝트 정렬',
        newest: '최신순',
        oldest: '오래된순',
        name: '이름',
        newProject: '새 프로젝트',
        language: '언어',
        languageDesc: '홈 화면에 사용할 언어를 선택하세요.',
        languageFoot: '언어 선택은 홈 화면에 즉시 적용됩니다.',
        noProjects: '아직 프로젝트가 없습니다',
        noProjectsDesc: '새 프로젝트를 만들거나 미디어를 가져와 시작하세요.',
        unsaved: '저장되지 않음',
        today: '오늘',
        openProject: '프로젝트 열기',
        untitled: '제목 없음',
      },
    },
    {
      meta: { id: 'tr', code: 'TR', name: 'Türkçe', region: 'Türkiye', flag: '\uD83C\uDDF9\uD83C\uDDF7', locale: 'tr-TR' },
      strings: {
        import: 'İÇE AKTAR',
        workspace: 'YEREL ÇALIŞMA ALANI',
        projects: 'Projeleriniz',
        sort: 'Projeleri sırala',
        newest: 'En yeni',
        oldest: 'En eski',
        name: 'Ad',
        newProject: 'YENİ PROJE',
        language: 'Dil',
        languageDesc: 'Ana ekran için bir dil seçin.',
        languageFoot: 'Dil seçimi ana ekrana hemen uygulanır.',
        noProjects: 'Henüz proje yok',
        noProjectsDesc: 'Başlamak için yeni bir proje oluşturun veya medya içe aktarın.',
        unsaved: 'Kaydedilmedi',
        today: 'Bugün',
        openProject: 'Projeyi aç',
        untitled: 'Adsız',
      },
    },
    {
      meta: { id: 'ru', code: 'RU', name: 'Русский', region: 'Россия', flag: '\uD83C\uDDF7\uD83C\uDDFA', locale: 'ru-RU' },
      strings: {
        import: 'ИМПОРТ',
        workspace: 'ЛОКАЛЬНОЕ ПРОСТРАНСТВО',
        projects: 'Ваши проекты',
        sort: 'Сортировать проекты',
        newest: 'Сначала новые',
        oldest: 'Сначала старые',
        name: 'Название',
        newProject: 'НОВЫЙ ПРОЕКТ',
        language: 'Язык',
        languageDesc: 'Выберите язык главного экрана.',
        languageFoot: 'Выбор языка сразу применяется к главному экрану.',
        noProjects: 'Проектов пока нет',
        noProjectsDesc: 'Создайте новый проект или импортируйте медиа, чтобы начать.',
        unsaved: 'Не сохранено',
        today: 'Сегодня',
        openProject: 'Открыть проект',
        untitled: 'Без названия',
      },
    },
    {
      meta: { id: 'hi', code: 'हिं', name: 'हिन्दी', region: 'भारत', flag: '\uD83C\uDDEE\uD83C\uDDF3', locale: 'hi-IN' },
      strings: {
        import: 'आयात',
        workspace: 'स्थानीय कार्यक्षेत्र',
        projects: 'आपकी परियोजनाएँ',
        sort: 'परियोजनाएँ क्रमबद्ध करें',
        newest: 'नवीनतम',
        oldest: 'सबसे पुरानी',
        name: 'नाम',
        newProject: 'नई परियोजना',
        language: 'भाषा',
        languageDesc: 'होम स्क्रीन के लिए भाषा चुनें।',
        languageFoot: 'भाषा का चयन तुरंत होम स्क्रीन पर लागू होता है।',
        noProjects: 'अभी कोई परियोजना नहीं',
        noProjectsDesc: 'शुरू करने के लिए नई परियोजना बनाएँ या मीडिया आयात करें।',
        unsaved: 'सहेजा नहीं गया',
        today: 'आज',
        openProject: 'परियोजना खोलें',
        untitled: 'बिना शीर्षक',
      },
    },
    {
      meta: { id: 'ar', code: 'ع', name: 'العربية', region: 'الشرق الأوسط', flag: '\uD83C\uDDF8\uD83C\uDDE6', locale: 'ar-SA', rtl: true },
      strings: {
        import: 'استيراد',
        workspace: 'مساحة عمل محلية',
        projects: 'مشاريعك',
        sort: 'ترتيب المشاريع',
        newest: 'الأحدث',
        oldest: 'الأقدم',
        name: 'الاسم',
        newProject: 'مشروع جديد',
        language: 'اللغة',
        languageDesc: 'اختر لغة للشاشة الرئيسية.',
        languageFoot: 'يُطبَّق اختيار اللغة على الشاشة الرئيسية فورًا.',
        noProjects: 'لا توجد مشاريع بعد',
        noProjectsDesc: 'أنشئ مشروعًا جديدًا أو استورد وسائط للبدء.',
        unsaved: 'غير محفوظ',
        today: 'اليوم',
        openProject: 'فتح المشروع',
        untitled: 'بدون عنوان',
      },
    },
  ];

  var applied = false;
  var failures = [];

  function log(m) {
    try {
      var n = window.EditorsHubNative || window.OpenMotionNative;
      if (n && n.log) n.log('INFO', 'amz-languages: ' + m);
    } catch (e) {}
  }

  /**
   * Extends HOME_LANGUAGES and HOME_I18N.
   *
   * They are declared with const, so reassignment throws; the entries are pushed and added
   * key by key instead, which is legal and leaves the existing fourteen untouched.
   */
  function install() {
    if (applied) return true;
    var langs = window.HOME_LANGUAGES;
    var i18n = window.HOME_I18N;
    if (!langs || !i18n) return false;

    var existing = {};
    for (var i = 0; i < langs.length; i++) existing[langs[i].id] = true;

    var added = 0;
    ADDITIONS.forEach(function (entry) {
      try {
        if (!existing[entry.meta.id]) {
          langs.push(entry.meta);
          added++;
        }
        i18n[entry.meta.id] = entry.strings;
      } catch (e) {
        failures.push(entry.meta.id + ': ' + e.message);
      }
    });

    /* Reflect the additions in the editor's own language dropdown too, if it is present. */
    try {
      var select = document.getElementById('langSelect') || document.querySelector('[data-language-select]');
      if (select) {
        ADDITIONS.forEach(function (entry) {
          var has = false;
          for (var o = 0; o < select.options.length; o++) {
            if (select.options[o].value === entry.meta.id) { has = true; break; }
          }
          if (!has) {
            var opt = document.createElement('option');
            opt.value = entry.meta.id;
            opt.textContent = entry.meta.name;
            select.appendChild(opt);
          }
        });
      }
    } catch (e) {
      log('could not extend the dropdown: ' + e.message);
    }

    applied = added > 0 || failures.length === 0;
    if (added) log(added + ' languages added (' + langs.length + ' total)');
    return applied;
  }

  /** Applies right-to-left layout for Arabic and back again for everything else. */
  function applyDirection(langId) {
    var rtl = langId === 'ar';
    try {
      document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    } catch (e) {}
    return rtl;
  }

  window.omsAmzLanguages = {
    ADDITIONS: ADDITIONS,
    install: install,
    applyDirection: applyDirection,
    failures: failures,
    get applied() { return applied; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { install(); });
  } else {
    install();
  }
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (install()) { clearInterval(timer); if (window.omsAmzBridge) window.omsAmzBridge.report('languages', true); }
    else if (tries > 60) { clearInterval(timer); if (window.omsAmzBridge) window.omsAmzBridge.gaveUp('languages', 'HOME_LANGUAGES or HOME_I18N missing'); }
  }, 500);
})();
