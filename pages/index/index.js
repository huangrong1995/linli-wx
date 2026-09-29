const { request } = require('../../utils/request');
const auth = require('../../utils/auth');

Page({
  data: {
    types: [
      { v: 'all', label: '全部' }, { v: 'sale', label: '出售' },
      { v: 'lend', label: '借用' }, { v: 'rent', label: '出租' },
    ],
    typeLabel: { sale: '出售', lend: '借用', rent: '出租' },
    curType: 'all', keyword: '', page: 1, items: [], loading: false,
    hasMore: true, _favs: {},
  },
  onLoad() { this.refresh(); },
  onPullDownRefresh() { this.refresh().then(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasMore) this.loadMore(); },
  refresh() {
    this.setData({ page: 1, items: [], hasMore: true });
    return this.fetchPage(1, true);
  },
  loadMore() { this.fetchPage(this.data.page + 1); },
  fetchPage(page, replace) {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });
    const qs = `type=${this.data.curType}&q=${encodeURIComponent(this.data.keyword)}&page=${page}`;
    return request({ url: `/api/items/?${qs}`, showLoading: false })
      .then((data) => {
        const results = data.results || [];
        const withFav = results.map((it) => Object.assign({}, it, { _fav: !!this.data._favs[it.id] }));
        const items = replace ? withFav : this.data.items.concat(withFav);
        this.setData({
          items, page,
          hasMore: !!data.next,
          loading: false,
        });
      })
      .catch(() => this.setData({ loading: false }));
  },
  onTypeTap(e) { this.setData({ curType: e.currentTarget.dataset.type }); this.refresh(); },
  onKeyword(e) { this.setData({ keyword: e.detail.value }); },
  onSearch() { this.refresh(); },
  onItemTap(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` }); },
  _loadFavs() {
    if (!auth.isApproved()) return;
    request({ url: '/api/items/favorites/' }).then((data) => {
      const m = {};
      (data.results || []).forEach((it) => { m[it.id] = true; });
      this.data._favs = m;
      this.setData({ items: this.data.items.map((it) => Object.assign({}, it, { _fav: !!m[it.id] })) });
    }).catch(() => {});
  },
  onFavTap(e) {
    if (!auth.isApproved()) {
      wx.showToast({ title: '需审核通过后才能收藏', icon: 'none' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    const isFav = !!this.data._favs[id];
    const method = isFav ? 'DELETE' : 'POST';
    request({ url: `/api/items/${id}/favorite/`, method }).then((data) => {
      this.data._favs[id] = data.favorited;
      this.setData({ items: this.data.items.map((it) => it.id === id ? Object.assign({}, it, { _fav: data.favorited }) : it) });
    }).catch((err) => wx.showToast({ title: err.message || '操作失败', icon: 'none' }));
  },
  onShow() { this._loadFavs(); this.refresh(); },
});
