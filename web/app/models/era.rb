class Era < ApplicationRecord
  TONES = %w[ochre moss slate oxblood plum teal].freeze

  belongs_to :fellow
  validates :title, :start_year, presence: true
  validates :tone, inclusion: { in: TONES }
  validate :years_in_order

  def range_label = end_year ? "#{start_year}–#{end_year}" : "#{start_year}–today"
  def covers?(year) = year && year >= start_year && (end_year.nil? || year <= end_year)

  private

  def years_in_order
    errors.add(:end_year, "must be after the start year") if end_year && start_year && end_year < start_year
  end
end
