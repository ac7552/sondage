class Event < ApplicationRecord
  STAGES = %w[intake ten_by_ten refining after_interview].freeze
  STAGE_LABELS = { "intake" => "at intake", "ten_by_ten" => "in the 10x10 session", "refining" => "while refining the profile", "after_interview" => "after the interview" }.freeze

  belongs_to :fellow
  belongs_to :added_by, class_name: "User", optional: true
  has_many :items, dependent: :nullify
  has_many :ten_by_ten_entries, dependent: :nullify

  validates :title, :year, presence: true
  validates :month, inclusion: { in: 1..12 }, allow_nil: true
  validates :stage_added, inclusion: { in: STAGES }

  def when_label = date_text.presence || [ (Date::MONTHNAMES[month] if month), year ].compact.join(" ")
end
