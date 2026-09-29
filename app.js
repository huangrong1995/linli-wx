const auth = require('./utils/auth');

App({
  globalData: { profile: null },
  onLaunch() {
    // 启动静默登录（可失败，浏览仍可用）
    auth.ensureLogin().then((profile) => {
      this.globalData.profile = profile;
    }).catch(() => {});
  },
  onShow() {
    // 前台化时刷新资料，确保管理员审核后的状态生效
    auth.refreshProfile().then((p) => { if (p) this.globalData.profile = p; }).catch(() => {});
  },
});