interface SaveNoticeProps {
  message: string
  onClose: () => void
}

export default function SaveNotice({ message, onClose }: SaveNoticeProps) {
  return (
    <div className="save-notice" role="status" aria-label="Save notice">
      <span>{message}</span>
      <button type="button" aria-label="Dismiss notice" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
