const auth = require('../../utils/auth');
const { request } = require('../../utils/request');

Page({
  data: {
    profile: null, unread: 0,
    statusLabel: { pending: '待审核', approved: '已通过', rejected: '未通过' },
  },
  onShow() {
    const profile = auth.getProfile();
    if (profile) {
      this.setData({ profile });
      request({ url: '/api/notifications/unread-count/' }).then((d) => this.setData({ unread: d.unread_count })).catch(() => {});
    } else {
      auth.silentLogin().then((d) => this.setData({ profile: d.user })).catch(() => {});
    }
  },
  onLogout() {
    auth.logout().then(() => this.setData({ profile: null, unread: 0 }));
  },
});
