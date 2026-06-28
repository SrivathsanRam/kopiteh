import { describe, it, expect } from 'vitest'

// ── Pricing logic extracted for testing (mirrors backend SQL + frontend display) ──

interface OrderData {
  order_type?: 'STANDARD' | 'CUSTOM'
  total_price?: number | string | null
  unit_price?: number | string | null
  quantity?: number | null
  items?: Array<{
    price: number
    quantity: number
    modifiers?: Array<{ price_modifier: number | string }>
  }>
}

/** Mirrors the backend SQL COALESCE logic for computing total_price */
export function computeOrderTotal(order: OrderData): number {
  if (order.order_type === 'CUSTOM') {
    // Backend: COALESCE(..., COALESCE(coi.price, 0) * COALESCE(coi.quantity, 0))
    const unitPrice = Number(order.unit_price ?? 0)
    const qty = Number(order.quantity ?? 0)
    const rawTotal = unitPrice * qty
    // Backend wraps in COALESCE(subquery, rawTotal)
    // subquery returns 0 for custom orders (no standard order_item rows)
    return Number(order.total_price ?? rawTotal)
  }

  // STANDARD orders: total comes from backend subquery
  if (order.total_price != null) return Number(order.total_price)

  // Fallback computation for standard orders (item-level)
  const items = order.items ?? []
  return items.reduce((sum, item) => {
    const modifiersTotal = (item.modifiers ?? []).reduce(
      (s, m) => s + Number(m.price_modifier ?? 0),
      0
    )
    return sum + (item.price + modifiersTotal) * item.quantity
  }, 0)
}

/** Safe price formatting used in OrderRow display */
export function formatPrice(value: number | string | null | undefined): string {
  const num = value != null ? Number(value) : 0
  return num.toFixed(2)
}

/** Excel export row formatting */
export function exportOrderRow(o: {
  order_id: string | number
  created_at: string
  venue_name: string
  table_number: string
  status: string
  order_type?: string
  total_price?: number | string | null
  user_name?: string | null
}): (string | number)[] {
  return [
    o.order_id,
    o.user_name ?? '',
    new Date(o.created_at).toLocaleDateString('en-GB'),
    o.venue_name,
    o.table_number,
    o.status,
    o.order_type ?? 'STANDARD',
    parseFloat(o.total_price?.toString() ?? '0'),
  ]
}

// ── Tests ──

describe('computeOrderTotal', () => {
  it('returns 0 for custom order with null price and quantity', () => {
    const order: OrderData = {
      order_type: 'CUSTOM',
      unit_price: null,
      quantity: null,
    }
    expect(computeOrderTotal(order)).toBe(0)
  })

  it('returns 0 for custom order with 0 price and 0 quantity', () => {
    const order: OrderData = {
      order_type: 'CUSTOM',
      unit_price: 0,
      quantity: 0,
    }
    expect(computeOrderTotal(order)).toBe(0)
  })

  it('computes custom order total: unit_price * quantity', () => {
    const order: OrderData = {
      order_type: 'CUSTOM',
      unit_price: 12.5,
      quantity: 3,
    }
    expect(computeOrderTotal(order)).toBe(37.5)
  })

  it('uses total_price from backend if provided (custom order)', () => {
    const order: OrderData = {
      order_type: 'CUSTOM',
      total_price: 45,
      unit_price: 10,
      quantity: 3, // 10 * 3 = 30, but total_price is 45
    }
    expect(computeOrderTotal(order)).toBe(45)
  })

  it('uses total_price from backend for standard orders', () => {
    const order: OrderData = {
      order_type: 'STANDARD',
      total_price: 99.95,
    }
    expect(computeOrderTotal(order)).toBe(99.95)
  })

  it('computes standard order total from items when total_price is missing', () => {
    const order: OrderData = {
      order_type: 'STANDARD',
      items: [
        { price: 10, quantity: 1 },
        { price: 5, quantity: 2 },
      ],
    }
    expect(computeOrderTotal(order)).toBe(20)
  })

  it('includes modifier totals for standard orders', () => {
    const order: OrderData = {
      order_type: 'STANDARD',
      items: [
        {
          price: 10,
          quantity: 1,
          modifiers: [
            { price_modifier: 2 },
            { price_modifier: 1.5 },
          ],
        },
      ],
    }
    expect(computeOrderTotal(order)).toBe(13.5)
  })

  it('handles string price values', () => {
    const order: OrderData = {
      order_type: 'CUSTOM',
      unit_price: '8.50',
      quantity: '2',
    }
    expect(computeOrderTotal(order)).toBe(17)
  })

  it('handles undefined quantity gracefully', () => {
    const order: OrderData = {
      order_type: 'CUSTOM',
      unit_price: 10,
      quantity: undefined,
    }
    expect(computeOrderTotal(order)).toBe(0)
  })

  it('returns 0 for standard order with no items and no total_price', () => {
    const order: OrderData = {
      order_type: 'STANDARD',
    }
    expect(computeOrderTotal(order)).toBe(0)
  })
})

describe('formatPrice', () => {
  it('formats a normal number', () => {
    expect(formatPrice(12.5)).toBe('12.50')
  })

  it('formats 0 correctly', () => {
    expect(formatPrice(0)).toBe('0.00')
  })

  it('handles null as 0.00', () => {
    expect(formatPrice(null)).toBe('0.00')
  })

  it('handles undefined as 0.00', () => {
    expect(formatPrice(undefined)).toBe('0.00')
  })

  it('handles string input', () => {
    expect(formatPrice('5')).toBe('5.00')
  })

  it('handles empty string', () => {
    expect(formatPrice('')).toBe('0.00')
  })

  it('rounds to 2 decimal places', () => {
    expect(formatPrice(10.999)).toBe('11.00')
  })
})

describe('exportOrderRow', () => {
  it('includes user_name in export after order_id', () => {
    const row = exportOrderRow({
      order_id: 'ORDER-1',
      created_at: '2025-01-15T10:30:00Z',
      venue_name: 'Main Hall',
      table_number: 'A1',
      status: 'COMPLETED',
      total_price: 45.0,
      user_name: 'John',
    })
    expect(row[0]).toBe('ORDER-1')
    expect(row[1]).toBe('John')
    expect(row[7]).toBe(45)
  })

  it('handles null user_name', () => {
    const row = exportOrderRow({
      order_id: 'ORDER-2',
      created_at: '2025-01-15T10:30:00Z',
      venue_name: 'Main Hall',
      table_number: 'A2',
      status: 'PENDING',
      total_price: 0,
      user_name: null,
    })
    expect(row[1]).toBe('')
  })

  it('handles null total_price in export', () => {
    const row = exportOrderRow({
      order_id: 'CUSTOM-1',
      created_at: '2025-01-15T10:30:00Z',
      venue_name: 'Canteen',
      table_number: 'B3',
      status: 'INCOMING',
      total_price: null,
    })
    expect(row[7]).toBe(0)
  })

  it('correctly formats decimal total_price', () => {
    const row = exportOrderRow({
      order_id: 'ORDER-3',
      created_at: '2025-01-15T10:30:00Z',
      venue_name: 'Cafe',
      table_number: 'C5',
      status: 'COMPLETED',
      total_price: '12.75',
    })
    expect(row[7]).toBe(12.75)
  })
})
