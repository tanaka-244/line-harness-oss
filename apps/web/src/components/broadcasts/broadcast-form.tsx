'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, type ApiBroadcast } from '@/lib/api'
import FlexPreviewComponent from '@/components/flex-preview'

interface BroadcastFormProps {
  tags: Tag[]
  accountId?: string | null
  initialData?: ApiBroadcast | null
  onSuccess: () => void
  onCancel: () => void
}

const messageTypeLabels: Record<ApiBroadcast['messageType'], string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flexメッセージ',
}

interface FormState {
  title: string
  messageType: ApiBroadcast['messageType']
  messageContent: string
  altText: string
  targetType: ApiBroadcast['targetType']
  targetTagId: string
  scheduledAt: string
  sendNow: boolean
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const jst = new Date(date.getTime() + (9 * 60 * 60 * 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
}

function toFormState(broadcast?: ApiBroadcast | null): FormState {
  if (!broadcast) {
    return {
      title: '',
      messageType: 'text',
      messageContent: '',
      altText: '',
      targetType: 'all',
      targetTagId: '',
      scheduledAt: '',
      sendNow: true,
    }
  }

  return {
    title: broadcast.title,
    messageType: broadcast.messageType,
    messageContent: broadcast.messageContent,
    altText: broadcast.altText ?? '',
    targetType: broadcast.targetType,
    targetTagId: broadcast.targetTagId ?? '',
    scheduledAt: toDatetimeLocal(broadcast.scheduledAt),
    sendNow: !broadcast.scheduledAt,
  }
}

export default function BroadcastForm({ tags, accountId, initialData, onSuccess, onCancel }: BroadcastFormProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(initialData))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isEdit = Boolean(initialData)

  useEffect(() => {
    setForm(toFormState(initialData))
    setError('')
  }, [initialData])

  const selectableTags = useMemo(() => {
    if (!form.targetTagId || tags.some((tag) => tag.id === form.targetTagId)) return tags
    return [{ id: form.targetTagId, name: '現在のタグ', color: '#9CA3AF', createdAt: '' }, ...tags]
  }, [form.targetTagId, tags])

  const handleSave = async () => {
    if (!form.title.trim()) { setError('配信タイトルを入力してください'); return }
    if (!form.messageContent.trim()) { setError('メッセージ内容を入力してください'); return }
    if ((form.targetType === 'tag' || form.targetType === 'tag_exclude') && selectableTags.length === 0) {
      setError('このアカウントにはタグ付き友だちがまだいないため、タグ配信は作成できません。')
      return
    }
    if (form.messageType === 'flex') {
      try { JSON.parse(form.messageContent) } catch { setError('FlexメッセージのJSONが無効です'); return }
    }
    if (!form.sendNow && !form.scheduledAt) {
      setError('予約配信の場合は配信日時を指定してください')
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        title: form.title,
        messageType: form.messageType,
        messageContent: form.messageContent,
        altText: form.altText.trim() || null,
        targetType: form.targetType,
        targetTagId: (form.targetType === 'tag' || form.targetType === 'tag_exclude') ? form.targetTagId || null : null,
        scheduledAt: form.sendNow || !form.scheduledAt
          ? null
          : form.scheduledAt + ':00.000+09:00',
      }
      const res = initialData
        ? await api.broadcasts.update(initialData.id, payload, { accountId: accountId || undefined })
        : await api.broadcasts.create({
            ...payload,
            status: 'draft',
            lineAccountId: accountId ?? null,
          })
      if (res.success) {
        onSuccess()
      } else {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <h2 className="text-sm font-semibold text-gray-800 mb-5">
        {isEdit ? '配信を編集' : '新規配信を作成'}
      </h2>

      <div className="space-y-4 max-w-lg">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            配信タイトル <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="例: 3月のキャンペーン告知"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        {/* Message type */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">メッセージ種別</label>
          <div className="flex gap-2">
            {(Object.keys(messageTypeLabels) as ApiBroadcast['messageType'][]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setForm({ ...form, messageType: type })}
                className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                  form.messageType === type
                    ? 'border-green-500 text-green-700 bg-green-50'
                    : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
                }`}
              >
                {messageTypeLabels[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Message content */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            メッセージ内容 <span className="text-red-500">*</span>
            {(form.messageType === 'flex' || form.messageType === 'image') && (
              <span className="ml-1 text-gray-400">(JSON形式)</span>
            )}
          </label>

          {/* Image helper: URL inputs that auto-generate the required LINE image JSON */}
          {form.messageType === 'image' && (() => {
            let parsed: { originalContentUrl?: string; previewImageUrl?: string } = {}
            try { parsed = JSON.parse(form.messageContent) } catch { /* not yet valid */ }
            return (
              <div className="space-y-2 mb-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">元画像URL (originalContentUrl)</label>
                  <input
                    type="url"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="https://example.com/image.png"
                    value={parsed.originalContentUrl ?? ''}
                    onChange={(e) => {
                      const orig = e.target.value
                      const prev = parsed.previewImageUrl ?? orig
                      setForm({ ...form, messageContent: JSON.stringify({ originalContentUrl: orig, previewImageUrl: prev }) })
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">プレビュー画像URL (previewImageUrl)</label>
                  <input
                    type="url"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="https://example.com/preview.png (空欄で元画像と同じ)"
                    value={parsed.previewImageUrl ?? ''}
                    onChange={(e) => {
                      const prev = e.target.value
                      setForm({ ...form, messageContent: JSON.stringify({ originalContentUrl: parsed.originalContentUrl ?? '', previewImageUrl: prev }) })
                    }}
                  />
                </div>
              </div>
            )
          })()}

          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
            rows={form.messageType === 'flex' ? 8 : form.messageType === 'image' ? 3 : 4}
            placeholder={
              form.messageType === 'text'
                ? '配信するメッセージを入力...'
                : form.messageType === 'image'
                ? '{"originalContentUrl":"...","previewImageUrl":"..."}'
                : '{"type":"bubble","body":{...}}'
            }
            value={form.messageContent}
            onChange={(e) => setForm({ ...form, messageContent: e.target.value })}
            style={{ fontFamily: form.messageType !== 'text' ? 'monospace' : 'inherit' }}
          />
          {form.messageType === 'image' && (
            <p className="text-xs text-gray-400 mt-1">上のURLフォームか、直接JSONを編集できます</p>
          )}
          {form.messageType === 'flex' && form.messageContent && (() => {
            try { JSON.parse(form.messageContent); return true } catch { return false }
          })() && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 mb-2">プレビュー</p>
              <FlexPreviewComponent content={form.messageContent} maxWidth={300} />
            </div>
          )}
        </div>

        {(form.messageType === 'flex' || form.messageType === 'image') && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              通知テキスト
            </label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="未入力時は内容から自動生成"
              value={form.altText}
              onChange={(e) => setForm({ ...form, altText: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">LINE の通知や一覧で見える代替テキストです。</p>
          </div>
        )}

        {/* Target */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">配信対象</label>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'all', targetTagId: '' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'all'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              全員
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'tag' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'tag'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              タグで絞り込み
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'tag_exclude' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'tag_exclude'
                  ? 'border-orange-500 text-orange-700 bg-orange-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              タグなし（除外）
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, targetType: 'no_tags', targetTagId: '' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.targetType === 'no_tags'
                  ? 'border-orange-500 text-orange-700 bg-orange-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              タグなし（全員）
            </button>
          </div>
          {form.targetType === 'no_tags' && (
            <p className="text-xs text-orange-600 mb-1">タグを1件も持っていない人全員に配信します</p>
          )}
          {(form.targetType === 'tag' || form.targetType === 'tag_exclude') && (
            <>
              {selectableTags.length === 0 ? (
                <p className="text-xs text-amber-700 mb-1">
                  このアカウントにはまだタグ付き友だちがいません。先に友だちへタグを付けると、タグ配信を作成できます。
                </p>
              ) : null}
              {form.targetType === 'tag_exclude' && (
                <p className="text-xs text-orange-600 mb-1">このタグを持っていない人に配信します</p>
              )}
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                value={form.targetTagId}
                disabled={selectableTags.length === 0}
                onChange={(e) => setForm({ ...form, targetTagId: e.target.value })}
              >
                <option value="">{selectableTags.length === 0 ? '利用可能なタグがありません' : 'タグを選択...'}</option>
                {selectableTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            </>
          )}
        </div>

        {/* Schedule */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">配信タイミング</label>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, sendNow: true, scheduledAt: '' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.sendNow
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              下書きとして保存
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, sendNow: false })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                !form.sendNow
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              予約配信
            </button>
          </div>
          {!form.sendNow && (
            <input
              type="datetime-local"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
            />
          )}
        </div>

        {/* Error */}
        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? (isEdit ? '更新中...' : '作成中...') : (isEdit ? '更新' : '作成')}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
