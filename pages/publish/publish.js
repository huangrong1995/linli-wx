const { request, uploadFile } = require('../../utils/request');
const auth = require('../../utils/auth');

Page({
  data: {
    types: [{ v: 'sale', label: '出售' }, { v: 'lend', label: '借用' }, { v: 'rent', label: '出租' }],
    curTypeIdx: 0, title: '', description: '', price: '', phone: '', image: null,
  },
  onLoad() {
    if (!auth.isApproved()) {
      wx.showModal({ title: '提示', content: '需通过审核后才能发布物品', showCancel: false, success: () => wx.navigateBack() });
    }
  },
  onType(e) { this.setData({ curTypeIdx: Number(e.detail.value) }); },
  onTitle(e) { this.setData({ title: e.detail.value }); },
  onDesc(e) { this.setData({ description: e.detail.value }); },
  onPrice(e) { this.setData({ price: e.detail.value }); },
  onPhone(e) { this.setData({ phone: e.detail.value }); },
  onChooseImage() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'],
      success: (res) => this.setData({ image: res.tempFiles[0].tempFilePath }),
    });
  },
  submit() {
    const { title, description, price, phone, curTypeIdx } = this.data;
    if (!title || !phone) return wx.showToast({ title: '请填写名称和电话', icon: 'none' });
    const formData = {
      item_type: this.data.types[curTypeIdx].v, title, description,
      price: price || '0', contact_phone: phone,
    };
    const upload = this.data.image
      ? uploadFile({ url: '/api/items/', filePath: this.data.image, name: 'image', formData })
      : request({ url: '/api/items/', method: 'POST', data: formData });
    upload.then((item) => {
      wx.showToast({ title: '发布成功', icon: 'success' });
      wx.redirectTo({ url: `/pages/detail/detail?id=${item.id}` });
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },
});
