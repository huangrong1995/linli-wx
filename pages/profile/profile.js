const { request } = require('../../utils/request');
const auth = require('../../utils/auth');
Page({
  data: { form: { phone: '', community: '', building: '', room: '', email: '' }, status: '' },
  onLoad() {
    const p = auth.getProfile();
    if (p) {
      this.setData({
        form: { phone: p.phone || '', community: p.community || '', building: p.building || '', room: p.room || '', email: p.email || '' },
        status: p.status || '',
      });
    } else {
      request({ url: '/api/auth/me/' }).then((me) => {
        this.setData({
          form: { phone: me.phone || '', community: me.community || '', building: me.building || '', room: me.room || '', email: me.email || '' },
          status: me.status || '',
        });
        auth.setProfile(me);
      }).catch(() => {});
    }
  },
  onPhone(e) { this.setData({ 'form.phone': e.detail.value }); },
  onCommunity(e) { this.setData({ 'form.community': e.detail.value }); },
  onBuilding(e) { this.setData({ 'form.building': e.detail.value }); },
  onRoom(e) { this.setData({ 'form.room': e.detail.value }); },
  onEmail(e) { this.setData({ 'form.email': e.detail.value }); },
  submit() {
    const f = this.data.form;
    if (!f.community || !f.building || !f.room || !f.phone) return wx.showToast({ title: '请填完整小区/楼栋/门牌/电话', icon: 'none' });
    request({ url: '/api/auth/profile/', method: 'POST', data: f }).then((profile) => {
      auth.setProfile(profile);
      this.setData({ status: profile.status });
      wx.showToast({ title: profile.status === 'approved' ? '已保存' : '已提交，等待审核', icon: 'none' });
    }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },
});