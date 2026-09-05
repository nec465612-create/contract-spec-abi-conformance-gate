import { fireEvent, render, screen } from '@testing-library/react'
import { TransactionProgress } from './TransactionProgress'
import { TRANSACTION_PHASES } from '../chain/write-coordinator'

const hash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`

describe('transaction progress', () => {
  it('keeps IDLE out of the public status region', () => {
    const { container } = render(<TransactionProgress progress={{ phase: 'IDLE' }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the exact pending phase and spinner without optimistic success', () => {
    render(<TransactionProgress progress={{ phase: 'VERIFYING_READBACK', hash }} />)
    expect(screen.getByRole('status')).toHaveAttribute('data-transaction-phase', 'VERIFYING_READBACK')
    expect(screen.getByText('Verifying authoritative readback')).toBeInTheDocument()
    expect(screen.getByText('VERIFYING_READBACK')).toBeInTheDocument()
    expect(screen.getByText(hash)).toBeInTheDocument()
    expect(screen.queryByText('Transaction verified')).not.toBeInTheDocument()
    expect(document.querySelector('.transaction-progress-spinner')).toBeInTheDocument()
  })

  it('covers every governed lifecycle phase with the matching public state', () => {
    const { rerender } = render(<TransactionProgress progress={{ phase: 'IDLE' }} />)
    for (const phase of TRANSACTION_PHASES.filter((value) => value !== 'IDLE')) {
      rerender(<TransactionProgress progress={{ phase, hash }} />)
      const region = screen.getByLabelText('Transaction progress')
      expect(region).toHaveAttribute('data-transaction-phase', phase)
      if (['WAITING_FOR_WALLET', 'SUBMITTED', 'WAITING_FOR_FINALITY', 'VERIFYING_EXECUTION', 'VERIFYING_READBACK'].includes(phase)) {
        expect(region.querySelector('.transaction-progress-spinner')).toBeInTheDocument()
      } else {
        expect(region.querySelector('.transaction-progress-spinner')).not.toBeInTheDocument()
      }
    }
  })

  it('uses an alert for rejected and failed terminal outcomes', () => {
    const { rerender } = render(<TransactionProgress progress={{ phase: 'REJECTED' }} />)
    expect(screen.getByRole('alert')).toHaveAttribute('data-transaction-phase', 'REJECTED')
    expect(document.querySelector('.transaction-progress-spinner')).not.toBeInTheDocument()
    rerender(<TransactionProgress progress={{ phase: 'FAILED', hash }} />)
    expect(screen.getByRole('alert')).toHaveAttribute('data-transaction-phase', 'FAILED')
  })

  it('copies the complete hash and exposes safe reconciliation', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const onReconcile = vi.fn()
    render(<TransactionProgress progress={{ phase: 'RECONCILIATION_REQUIRED', hash }} onReconcile={onReconcile} />)
    expect(screen.getByText(hash)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy hash' }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(hash))
    fireEvent.click(screen.getByRole('button', { name: 'Continue verification' }))
    expect(onReconcile).toHaveBeenCalledTimes(1)
  })
})
