const { request } = require('../../utils/request');
const auth = require('../../utils/auth');

Page({
  data: {
    tab: 'req', list: [],
    statusLabel: { pending: '待确认', confirmed: '已确认', completed: '已完成', cancelled: '已取消' },
    transTypeLabel: { sale: '买卖', lend: '借用', rent: '出租' },
  },
  onShow() { auth.ensureLogin().then(() => this.load()).catch(() => wx.navigateTo({ url: '/pages/mine/mine' })); },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab, list: [] }); this.load(); },
  load() {
    const url = this.data.tab === 'req' ? '/api/transactions/my-requests/' : '/api/transactions/my-received/';
    request({ url, showLoading: true }).then((data) => {
      const list = (data.results || []).map((t) => {
        const isOwner = t.is_owner;
        const canConfirm = isOwner && t.status === 'pending';
        const canComplete = isOwner && t.status === 'confirmed';
        const canCancel = t.status === 'pending' || t.status === 'confirmed';
        return Object.assign({}, t, { canConfirm, canComplete, canCancel });
      });
      this.setData({ list });
    });
  },
  act(e) {
    const { verb, idx } = e.currentTarget.dataset;
    const t = this.data.list[idx];
    request({ url: `/api/transactions/${t.id}/${verb}/`, method: 'POST' })
      .then(() => { wx.showToast({ title: '操作成功', icon: 'success' }); this.load(); })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },
});
