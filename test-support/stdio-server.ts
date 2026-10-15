import { writeFileSync } from 'node:fs';
import { connectStdioApplication } from '../src/cli.js';
import { createShoppingApplication } from '../src/runtime.js';
import { CartService } from '../src/services/cart.js';
import { OrderService, PurchaseHistoryService } from '../src/services/orders.js';
import { injectedServices } from './mcp-fixture.js';
import { ok, fail, rawCart, productForm, fixture, ordersPage } from './helpers.js';

const { services, state } = injectedServices();
const metrics = { writes: 0, cartReads: 0, detailReads: 0, waiting: false, closed: false };
const metricsPath = process.env.FIXTURE_METRICS;
if (!metricsPath) throw new Error('FIXTURE_METRICS is required');
const save = () => writeFileSync(metricsPath, JSON.stringify({ ...metrics, quantity: state.quantity }));
const scenario = process.env.FIXTURE_SCENARIO;
if (scenario === 'uncertain' || scenario === 'stall') {
  services.cart = new CartService({ async fetchCartControls() { throw new Error('Unexpected controls read'); }, async fetchCart() { metrics.cartReads++; if (scenario === 'stall') { metrics.waiting = true; save(); return new Promise(() => {}); } return ok(rawCart(2)); },
    async fetchProductForm() { return ok(productForm()); }, async submitCartMutation() { metrics.writes++; save(); return fail('upstream_unavailable'); } });
} else {
  const original = services.cart.addCartItem.bind(services.cart);
  services.cart.addCartItem = async (...args) => { const result = await original(...args); metrics.writes = state.writes; save(); return result; };
}
const orders = { async fetchOrderHistory() { return ok(ordersPage); }, async fetchOrderLines() { metrics.detailReads++; save(); return scenario === 'partial' && metrics.detailReads % 2 === 0 ? fail('order_details_unavailable') : ok(fixture('order')); } };
services.orders = new OrderService(orders); services.history = new PurchaseHistoryService(orders);
services.session.shutdown = async () => { metrics.closed = true; metrics.writes = Math.max(metrics.writes, state.writes); save(); };
const app = createShoppingApplication({ version: 'fixture', services });
await connectStdioApplication(app);
save();
