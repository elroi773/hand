import { useEffect, useRef } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  onDontShowAgain: () => void
}

export function GuideModal({ open, onClose, onDontShowAgain }: Props) {
  const primaryBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    primaryBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="guide-backdrop" role="dialog" aria-modal="true" aria-label="사용 방법 가이드">
      <div className="guide-modal">
        <h2 className="guide-title">지식 와앙~~</h2>

        <p className="guide-program-description">
          이 프로그램은 카메라로 손과 얼굴을 인식해, 손동작에 따라 활자가 생성되고
          머리 쪽으로 흡수되는 인터랙티브 AR 미디어 아트입니다.
        </p>

        <p className="guide-usage-description">
          카메라 앞에서 손바닥을 보여주면 활자가 반응합니다. 손의 움직임으로 지식을
          만들고, 흩트리고, 압축하고, 머릿속으로 지식을 흡수시킬 수 있습니다.
        </p>

        <ol className="guide-list">
          <li>
            <b>손바닥을 카메라에 가까이 보여주세요.</b>
            <span>손바닥이 화면에 잘 보이면 활자가 생성됩니다.</span>
          </li>
          <li>
            <b>양손을 책처럼 펼쳐보세요.</b>
            <span>손바닥 위에서 활자가 떠오릅니다.</span>
          </li>
          <li>
            <b>손을 위로 올려보세요.</b>
            <span>활자가 머리 쪽으로 더 빠르게 흡수됩니다.</span>
          </li>
          <li>
            <b>손을 좌우로 흔들어보세요.</b>
            <span>활자가 흩어졌다가 다시 정렬됩니다.</span>
          </li>
          <li>
            <b>손가락을 오므려보세요.</b>
            <span>활자가 손안으로 압축됩니다.</span>
          </li>
          <li>
            <b>손을 머리 가까이 가져가보세요.</b>
            <span>활자가 더 짧은 경로로 머릿속에 들어갑니다.</span>
          </li>
        </ol>

        <p className="guide-tip">팁: 손바닥을 카메라에 가까이 가져가면 더 잘 반응합니다.</p>

        <div className="guide-actions">
          <button
            ref={primaryBtnRef}
            className="guide-primary-button"
            onClick={onClose}
            aria-label="가이드를 닫고 시작하기"
          >
            시작하기
          </button>
          <button
            className="guide-secondary-button"
            onClick={onDontShowAgain}
            aria-label="다시 보지 않기"
          >
            다시 보지 않기
          </button>
        </div>
      </div>
    </div>
  )
}
