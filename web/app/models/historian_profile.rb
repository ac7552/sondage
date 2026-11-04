# What a Fellow sees when choosing a historian.
class HistorianProfile < ApplicationRecord
  belongs_to :user

  validates :headline, length: { maximum: 120 }
  validates :bio, length: { maximum: 2000 }
  validate { errors.add(:user, "must be a historian") unless user&.historian? }

  scope :accepting, -> { where(accepting: true) }

  def list(attr) = public_send(attr).to_s.split(",").map(&:strip).reject(&:blank?)

  def as_api_json
    { id: user_id, name: user.name, headline:, bio:, languages: list(:languages), regions: list(:regions), specialties: list(:specialties) }
  end
end
