# One row per Fellow-and-historian pair. Each side says whether they'd like to
# work together; when both do, an admin confirms the match.
class MatchInterest < ApplicationRecord
  MAX_FELLOW_CHOICES = 3
  STATUSES = %w[open confirmed declined closed].freeze

  belongs_to :fellow
  belongs_to :historian, class_name: "User"
  belongs_to :decided_by, class_name: "User", optional: true

  validates :status, inclusion: { in: STATUSES }
  validates :historian_id, uniqueness: { scope: :fellow_id }
  validate { errors.add(:historian, "must be a historian") unless historian&.historian? }
  validate :fellow_choice_limit

  scope :undecided, -> { where(status: "open") }
  scope :mutual, -> { undecided.where(fellow_wants: true, historian_wants: true) }
  scope :interested, -> { where("fellow_wants OR historian_wants") }

  def mutual? = fellow_wants && historian_wants

  # Confirming sets the Fellow's historian and closes the Fellow's other open choices.
  def confirm!(admin)
    transaction do
      update!(status: "confirmed", decided_by: admin, decided_at: Time.current)
      fellow.update!(historian: historian, seeking_historian: false)
      fellow.match_interests.undecided.where.not(id:).update_all(status: "closed", decided_at: Time.current, updated_at: Time.current)
    end
  end

  def decline!(admin) = update!(status: "declined", decided_by: admin, decided_at: Time.current)

  private

  def fellow_choice_limit
    return unless fellow_wants && status == "open" && fellow
    others = fellow.match_interests.undecided.where(fellow_wants: true).where.not(id:).count
    errors.add(:base, "You can choose up to #{MAX_FELLOW_CHOICES} historians") if others >= MAX_FELLOW_CHOICES
  end
end
