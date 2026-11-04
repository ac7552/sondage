# The Fellow's journal. Unlike the sealed interview, entries can be changed or
# deleted at any time, and they stay private unless the Fellow shares them with
# their historian. Admins and historians never see private entries.
class JournalEntry < ApplicationRecord
  VOICE_TYPES = %w[audio/webm audio/ogg audio/mp4 audio/mpeg audio/wav audio/x-wav audio/aac audio/x-m4a].freeze
  MAX_VOICE = 25.megabytes

  belongs_to :fellow
  belongs_to :era, optional: true
  belongs_to :journal_prompt, optional: true
  has_one_attached :voice

  validates :written_on, presence: true
  validate :has_words_or_voice
  validate :era_and_prompt_belong_to_fellow
  validate :voice_is_audio

  scope :newest_first, -> { order(written_on: :desc, created_at: :desc) }
  scope :shared, -> { where(shared_with_historian: true) }

  # Entries a person may read: the Fellow reads all of theirs; their historian and
  # admins read only what the Fellow shared.
  def self.readable_by(user, fellow)
    return none unless user && fellow
    return fellow.journal_entries if fellow.user_id == user.id
    return fellow.journal_entries.shared if user.admin? || user.can_see?(fellow)
    none
  end

  def owned_by?(user) = user && fellow.user_id == user.id

  def as_api_json
    {
      id:, body:, written_on: written_on.iso8601, shared_with_historian:,
      era: era && { id: era.id, title: era.title },
      prompt: journal_prompt && { id: journal_prompt.id, text: journal_prompt.text },
      voice: voice.attached? ? { content_type: voice.content_type, bytes: voice.byte_size } : nil,
      updated_at: updated_at.iso8601
    }
  end

  private

  def has_words_or_voice
    errors.add(:base, "Write something or record your voice") if body.blank? && !voice.attached?
  end

  def era_and_prompt_belong_to_fellow
    errors.add(:era, "is not part of this life story") if era && era.fellow_id != fellow_id
    errors.add(:journal_prompt, "is for someone else") if journal_prompt && journal_prompt.fellow_id != fellow_id
  end

  def voice_is_audio
    return unless voice.attached?
    errors.add(:voice, "must be a sound recording") unless voice.content_type.to_s.split(";").first.in?(VOICE_TYPES)
    errors.add(:voice, "is too long (25 MB at most)") if voice.byte_size > MAX_VOICE
  end
end
