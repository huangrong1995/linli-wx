const { request } = require('../../utils/request');
Page({
  data: { items: [] },
  onShow() { this.load(); },
  load() {
    request({ url: '/api/items/favorites/', showLoading: true })
      .then((data) => this.setData({ items: data.results || [] }))
      .catch(() => this.setData({ items: [] }));
  },
  onItemTap(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }); },
  onUnfav(e) {
    const id = e.currentTarget.dataset.id;
    request({ url: `/api/items/${id}/favorite/`, method: 'DELETE' })
      .then(() => this.load())
      .catch((e2) => wx.showToast({ title: e2.message, icon: 'none' }));
  },
});
