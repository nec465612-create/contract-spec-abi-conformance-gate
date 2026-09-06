import { render, screen } from '@testing-library/react'
import { friendlyError, sameAddress, WalletChooser } from './App'
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

describe('transaction recovery identity', () => {
  it('matches checksum and normalized forms of the same wallet address', () => {
    expect(sameAddress('0xe8D6C55838C39301c11D54fC9A38B9de298329F6', '0xe8d6c55838c39301c11d54fc9a38b9de298329f6')).toBe(true)
  })
})

describe('transaction error guidance', () => {
  it('does not claim a hash exists when the wallet rejects before submission', () => {
    const error = Object.assign(new Error('The wallet request was cancelled.'), { code: 'USER_REJECTED' })

    expect(friendlyError(error)).toBe('The wallet request was cancelled before submission. No transaction hash was created; retry only when you are ready to sign.')
  })
})
