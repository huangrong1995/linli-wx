const auth = require('../../utils/auth');
const { request } = require('../../utils/request');

const STATUS_CLASS = { approved: '', pending: 'tag-muted', rejected: 'tag-warn' };

Page({
  data: {
    profile: null, unread: 0,
    statusLabel: { pending: '待审核', approved: '已通过', rejected: '未通过' },
  },
  onShow() {
    auth.ensureLogin()
      .then(() => auth.refreshProfile())
      .then((profile) => {
        if (!profile) return;
        this.setData({ profile: this._annotate(profile) });
        request({ url: '/api/notifications/unread-count/' }).then((d) => this.setData({ unread: d.unread_count || 0 })).catch(() => {});
      })
      .catch(() => {
        const cached = auth.getProfile();
        if (cached) this.setData({ profile: this._annotate(cached) });
      });
  },
  _annotate(p) {
    return Object.assign({}, p, {
      _statusClass: STATUS_CLASS[p.status] || '',
      _initial: (p.username && p.username[0]) || '邻',
    });
  },
  onLogout() {
    auth.logout().then(() => this.setData({ profile: null, unread: 0 }));
  },
});