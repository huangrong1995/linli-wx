const { request } = require('../../utils/request');
const typeLabel = { new_transaction: '新交易', confirmed: '已确认', completed: '已完成', cancelled: '已取消', approval: '审核' };

Page({
  data: { list: [], typeLabel },
  onShow() { this.load(); },
  load() {
    return request({ url: '/api/notifications/', showLoading: true }).then((data) => {
      const list = (data.results || []).map((n) => Object.assign({}, n, { typeText: typeLabel[n.type] || n.type }));
      this.setData({ list });
      return request({ url: '/api/notifications/unread-count/' });
    }).then((d) => {
      if (d && d.unread_count > 0) wx.setTabBarBadge({ index: 1, text: String(d.unread_count) });
    }).catch(() => {});
  },
  onTap(e) {
    const id = e.currentTarget.dataset.id;
    request({ url: `/api/notifications/${id}/read/`, method: 'POST' }).then(() => {
      wx.removeTabBarBadge({ index: 1 });
      this.load();
    }).catch(() => {});
  },
});
