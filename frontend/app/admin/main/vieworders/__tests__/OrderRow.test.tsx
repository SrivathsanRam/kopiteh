import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrderRow } from '../components/OrderRow'
import type { Order } from '../page'

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    order_id: 1,
    table_id: 1,
    table_number: 'A1',
    venue_id: 1,
    venue_name: 'Main Hall',
    status: 'PENDING',
    total_price: 25.5,
    created_at: '2025-01-15T10:30:00Z',
    order_type: 'STANDARD',
    user_id: 1,
    type: 'STANDARD' as const,
    ...overrides,
  }
}

describe('OrderRow', () => {
  it('renders total_price for standard order', () => {
    const order = makeOrder({ total_price: 25.5 })
    render(
      <table>
        <tbody>
          <OrderRow
            order={order}
            isExpanded={false}
            isLoadingItems={false}
            onToggleExpand={() => {}}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('$25.50')).toBeInTheDocument()
  })

  it('renders zero total_price as $0.00', () => {
    const order = makeOrder({ total_price: 0 })
    render(
      <table>
        <tbody>
          <OrderRow
            order={order}
            isExpanded={false}
            isLoadingItems={false}
            onToggleExpand={() => {}}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('handles null total_price gracefully', () => {
    const order = makeOrder({ total_price: null as unknown as number })
    render(
      <table>
        <tbody>
          <OrderRow
            order={order}
            isExpanded={false}
            isLoadingItems={false}
            onToggleExpand={() => {}}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('renders total_price for custom order', () => {
    const order = makeOrder({
      order_id: 'CUSTOM-5',
      order_type: 'CUSTOM',
      total_price: 30,
      order_item_name: 'Special Drink',
      quantity: 2,
      unit_price: '15.00',
    })
    render(
      <table>
        <tbody>
          <OrderRow
            order={order}
            isExpanded={false}
            isLoadingItems={false}
            onToggleExpand={() => {}}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('$30.00')).toBeInTheDocument()
  })

  it('renders expanded custom order details with unit price and total', () => {
    const order = makeOrder({
      order_id: 'CUSTOM-8',
      order_type: 'CUSTOM',
      total_price: 16.0,
      order_item_name: 'Burger',
      quantity: 2,
      unit_price: '8.00',
    })
    render(
      <table>
        <tbody>
          <OrderRow
            order={order}
            isExpanded={true}
            isLoadingItems={false}
            onToggleExpand={() => {}}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('$8.00')).toBeInTheDocument() // unit price
    // $16.00 appears in both the table row TD and expanded detail Total
    const totalElements = screen.getAllByText('$16.00')
    expect(totalElements.length).toBeGreaterThanOrEqual(2)
  })

  it('shows custom order total as $0.00 when total_price is null', () => {
    const order = makeOrder({
      order_id: 'CUSTOM-9',
      order_type: 'CUSTOM',
      total_price: null as unknown as number,
      order_item_name: 'Empty',
      quantity: 1,
      unit_price: null as unknown as string,
    })
    render(
      <table>
        <tbody>
          <OrderRow
            order={order}
            isExpanded={true}
            isLoadingItems={false}
            onToggleExpand={() => {}}
          />
        </tbody>
      </table>
    )
    // The null-safe format produces 0.00
    const zeroElements = screen.getAllByText('$0.00')
    expect(zeroElements.length).toBeGreaterThanOrEqual(1)
  })

  it('renders standard order with expand button', () => {
    const order = makeOrder()
    render(
      <table>
        <tbody>
          <OrderRow
            order={order}
            isExpanded={false}
            isLoadingItems={false}
            onToggleExpand={() => {}}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('View Items')).toBeInTheDocument()
  })

  it('shows Loading state when fetching items', () => {
    const order = makeOrder()
    render(
      <table>
        <tbody>
          <OrderRow
            order={order}
            isExpanded={true}
            isLoadingItems={true}
            onToggleExpand={() => {}}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText('Loading items...')).toBeInTheDocument()
  })
})
