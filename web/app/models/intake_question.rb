class IntakeQuestion < ApplicationRecord
  KINDS = {
    "short_text" => "Short answer", "long_text" => "Paragraph", "year" => "Year",
    "date" => "Date", "select" => "Dropdown", "multi_select" => "Checkboxes"
  }.freeze

  has_many :intake_answers, dependent: :destroy
  default_scope { order(:position, :id) }
  validates :prompt, presence: true
  validates :kind, inclusion: { in: KINDS.keys }
  validate :options_for_choice_kinds

  def choice? = kind.in?(%w[select multi_select])
  def option_list = options.to_s.lines.map(&:strip).reject(&:blank?)

  private

  def options_for_choice_kinds
    errors.add(:options, "need at least two choices, one per line") if choice? && option_list.size < 2
  end
end
