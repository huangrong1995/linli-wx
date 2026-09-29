const { request } = require('../../utils/request');
Page({
  data: { items: [], statusLabel: { available: '可交易', reserved: '已预约', completed: '已成交' } },
  onShow() { this.load(); },
  load() {
    request({ url: '/api/items/mine/', showLoading: true })
      .then((data) => this.setData({ items: data.results || [] }))
      .catch(() => this.setData({ items: [] }));
  },
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除', content: '确定删除该物品？',
      success: (r) => {
        if (!r.confirm) return;
        request({ url: `/api/items/${id}/`, method: 'DELETE' }).then(() => this.load()).catch((e2) => wx.showToast({ title: e2.message, icon: 'none' }));
      },
    });
  },
  onItemTap(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }); },
});
