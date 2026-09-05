import { render, screen } from '@testing-library/react'
import { WalletChooser } from './App'
import type { WalletOption } from './wallet/types'

describe('wallet chooser', () => {
  it('opens with zero provider calls and only delegates the explicit selection', () => {
    const request = vi.fn(async () => ['0x1111111111111111111111111111111111111111'])
    const option: WalletOption = {
      id: 'metamask',
      label: 'MetaMask',
      icon: '/wallet-icons/metamask.svg',
      provider: { request },
      source: 'eip6963',
      uuid: 'test-wallet',
    }
    const onChoose = vi.fn()
    render(<WalletChooser open options={[option]} busyId={null} onChoose={onChoose} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Choose a wallet' })).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
    screen.getByRole('button', { name: /MetaMask/ }).click()
    expect(onChoose).toHaveBeenCalledWith(option)
    expect(request).not.toHaveBeenCalled()
  })
})
