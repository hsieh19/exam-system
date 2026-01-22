/**
 * 主题切换器模块
 * 支持：深色（默认）、浅色、深蓝 三种主题
 */

const ThemeSwitcher = {
  // 主题配置
  themes: {
    dark: { name: '深色', icon: '🌙' },
    light: { name: '浅色', icon: '☀️' },
    ocean: { name: '深蓝', icon: '🌊' }
  },

  // 存储键名
  STORAGE_KEY: 'exam-system-theme',

  /**
   * 初始化主题切换器
   */
  init() {
    // 加载保存的主题
    const savedTheme = localStorage.getItem(this.STORAGE_KEY) || 'dark';
    this.applyTheme(savedTheme);

    // 创建切换器UI
    this.createSwitcherUI();
  },

  /**
   * 创建主题切换器UI
   */
  createSwitcherUI() {
    // 如果已存在则不重复创建
    if (document.querySelector('.theme-switcher')) {
      return;
    }

    const switcher = document.createElement('div');
    switcher.className = 'theme-switcher';
    switcher.id = 'theme-switcher';

    // 创建图标
    const icon = document.createElement('span');
    icon.className = 'theme-switcher-icon';
    icon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4"></circle>
        <path d="M12 2v2"></path>
        <path d="M12 20v2"></path>
        <path d="m4.93 4.93 1.41 1.41"></path>
        <path d="m17.66 17.66 1.41 1.41"></path>
        <path d="M2 12h2"></path>
        <path d="M20 12h2"></path>
        <path d="m6.34 17.66-1.41 1.41"></path>
        <path d="m19.07 4.93-1.41 1.41"></path>
      </svg>
    `;

    // 创建下拉选择框
    const select = document.createElement('select');
    select.className = 'theme-switcher-select';
    select.id = 'theme-select';
    select.setAttribute('aria-label', '选择主题');

    // 添加选项
    Object.entries(this.themes).forEach(([value, config]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${config.icon} ${config.name}`;
      select.appendChild(option);
    });

    // 设置当前主题
    const currentTheme = localStorage.getItem(this.STORAGE_KEY) || 'dark';
    select.value = currentTheme;

    // 监听变化
    select.addEventListener('change', (e) => {
      this.applyTheme(e.target.value);
      this.saveTheme(e.target.value);
    });

    // 组装UI
    switcher.appendChild(icon);
    switcher.appendChild(select);

    const ensureRoot = () => {
      let root = document.getElementById('theme-switcher-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'theme-switcher-root';
        root.className = 'theme-switcher-root';
      }
      if (root.parentElement !== document.body) document.body.appendChild(root);
      return root;
    };

    const clearInlineStyle = () => {
      switcher.style.removeProperty('position');
      switcher.style.removeProperty('top');
      switcher.style.removeProperty('right');
      switcher.style.removeProperty('z-index');
    };

    const mountSwitcher = () => {
      const headerActions = document.getElementById('mobile-header-actions');
      const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
      if (isMobile && headerActions) {
        headerActions.appendChild(switcher);
        clearInlineStyle();
      } else {
        const root = ensureRoot();
        if (switcher.parentElement !== root) root.appendChild(switcher);
        clearInlineStyle();
      }
    };

    mountSwitcher();
    if (window.matchMedia) {
      const mql = window.matchMedia('(max-width: 768px)');
      const handleChange = () => {
        mountSwitcher();
      };
      if (mql.addEventListener) mql.addEventListener('change', handleChange);
      else mql.addListener(handleChange);
    }
  },

  /**
   * 应用主题
   * @param {string} theme - 主题名称
   */
  applyTheme(theme) {
    // 移除所有主题属性
    document.documentElement.removeAttribute('data-theme');

    // 应用新主题（dark主题使用默认样式，不需要data-theme）
    if (theme !== 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }

    // 更新图标
    this.updateIcon(theme);
  },

  /**
   * 更新切换器图标
   * @param {string} theme - 当前主题
   */
  updateIcon(theme) {
    const iconElement = document.querySelector('.theme-switcher-icon');
    if (!iconElement) return;

    const icons = {
      dark: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      `,
      light: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2"></path>
          <path d="M12 20v2"></path>
          <path d="m4.93 4.93 1.41 1.41"></path>
          <path d="m17.66 17.66 1.41 1.41"></path>
          <path d="M2 12h2"></path>
          <path d="M20 12h2"></path>
          <path d="m6.34 17.66-1.41 1.41"></path>
          <path d="m19.07 4.93-1.41 1.41"></path>
        </svg>
      `,
      ocean: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 12c.6-.9 1.5-1.5 2.5-1.5 2 0 2 3 4 3s2-3 4-3 2 3 4 3 2-3 4-3c1 0 1.9.6 2.5 1.5"></path>
          <path d="M2 18c.6-.9 1.5-1.5 2.5-1.5 2 0 2 3 4 3s2-3 4-3 2 3 4 3 2-3 4-3c1 0 1.9.6 2.5 1.5"></path>
          <path d="M2 6c.6-.9 1.5-1.5 2.5-1.5 2 0 2 3 4 3s2-3 4-3 2 3 4 3 2-3 4-3c1 0 1.9.6 2.5 1.5"></path>
        </svg>
      `
    };

    iconElement.innerHTML = icons[theme] || icons.dark;
  },

  /**
   * 保存主题到本地存储
   * @param {string} theme - 主题名称
   */
  saveTheme(theme) {
    localStorage.setItem(this.STORAGE_KEY, theme);
  },

  /**
   * 获取当前主题
   * @returns {string} 当前主题名称
   */
  getCurrentTheme() {
    return localStorage.getItem(this.STORAGE_KEY) || 'dark';
  }
};

// 页面加载时自动初始化
document.addEventListener('DOMContentLoaded', () => {
  ThemeSwitcher.init();
});

// 导出供其他模块使用
window.ThemeSwitcher = ThemeSwitcher;
