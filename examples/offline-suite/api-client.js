
export class PaymentGatewayClient {
  constructor({ baseUrl = 'https://api.stripe.com/v1', apiKey = 'sk_test_mock' } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  async createCustomer({ email, name }) {
    const res = await fetch(`${this.baseUrl}/customers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, name })
    });

    if (!res.ok) {
      throw new Error(`Payment Gateway Error: HTTP ${res.status}`);
    }

    return res.json();
  }

  async getInvoice(invoiceId) {
    const res = await fetch(`${this.baseUrl}/invoices/${invoiceId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });

    if (!res.ok) {
      throw new Error(`Invoice Not Found: HTTP ${res.status}`);
    }

    return {
      data: await res.json(),
      cacheSignal: res.headers.get('x-cache') || 'DIRECT'
    };
  }
}
