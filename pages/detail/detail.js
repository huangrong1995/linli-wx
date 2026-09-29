const { request } = require('../../utils/request');
const auth = require('../../utils/auth');

Page({
  data: {
    item: {}, showModal: false, message: '',
    typeLabel: { sale: '出售', lend: '借用', rent: '出租' },
    statusLabel: { available: '可交易', reserved: '已预约', completed: '已成交' },
  },
  onLoad(options) {
    this.id = options.id;
    this.load();
  },
  load() {
    request({ url: `/api/items/${this.id}/`, showLoading: true }).then((item) => this.setData({ item }));
  },
  onFavTap() {
    if (!auth.isApproved()) return wx.showToast({ title: '需审核通过才能收藏', icon: 'none' });
    const method = this.data.item.is_favorited ? 'DELETE' : 'POST';
    request({ url: `/api/items/${this.id}/favorite/`, method }).then((data) => {
      this.setData({ 'item.is_favorited': data.favorited });
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },
  onTransTap() {
    if (this.data.item.is_owner) return wx.showToast({ title: '不能对自己的物品发起交易', icon: 'none' });
    if (!auth.isApproved()) return wx.showToast({ title: '需审核通过才能交易', icon: 'none' });
    this.setData({ showModal: true });
  },
  hideModal() { this.setData({ showModal: false }); },
  onMessage(e) { this.setData({ message: e.detail.value }); },
  submitTrans() {
    request({ url: `/api/items/${this.id}/transactions/`, method: 'POST', data: { message: this.data.message } })
      .then(() => {
        this.setData({ showModal: false });
        wx.showToast({ title: '已发起交易请求', icon: 'success' });
      })
      .catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },
});
