const auth = require('../../utils/auth');
const { request } = require('../../utils/request');

Page({
  data: {
    profile: null, unread: 0,
    statusLabel: { pending: '待审核', approved: '已通过', rejected: '未通过' },
  },
  onShow() {
    // 重拉资料（管理员审核后状态生效），再取未读数
    auth.ensureLogin()
      .then(() => auth.refreshProfile())
      .then((profile) => {
        if (!profile) return;
        this.setData({ profile });
        request({ url: '/api/notifications/unread-count/' }).then((d) => this.setData({ unread: d.unread_count })).catch(() => {});
      })
      .catch(() => {
        const cached = auth.getProfile();
        if (cached) this.setData({ profile: cached });
      });
  },
  onLogout() {
    auth.logout().then(() => this.setData({ profile: null, unread: 0 }));
  },
});