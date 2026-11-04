# Something placed on the timeline: a photo, article, song, letter, document or place.
# "own" items come from the Fellow's life; "context" items were added to set the scene
# and are always labelled as such, with who added them.
class Item < ApplicationRecord
  KINDS = %w[photo article song letter document place].freeze
  SOURCES = { "own" => "From the Fellow's collection", "context" => "Added for context" }.freeze

  belongs_to :fellow
  belongs_to :event, optional: true
  belongs_to :added_by, class_name: "User", optional: true
  has_many :ten_by_ten_entries, dependent: :nullify
  has_one_attached :file

  validates :title, presence: true
  validates :kind, inclusion: { in: KINDS }
  validates :source, inclusion: { in: SOURCES.keys }
  validates :stage_added, inclusion: { in: Event::STAGES }
  validates :url, :archive_url, format: { with: %r{\Ahttps?://}i, message: "must start with http:// or https://" }, allow_blank: true
  validate :file_is_an_image_or_pdf

  def year_for_timeline = year || event&.year
  def when_label = date_text.presence || year_for_timeline&.to_s

  private

  def file_is_an_image_or_pdf
    return unless file.attached?
    errors.add(:file, "must be an image or a PDF") unless file.content_type.to_s.start_with?("image/") || file.content_type == "application/pdf"
  end
end
