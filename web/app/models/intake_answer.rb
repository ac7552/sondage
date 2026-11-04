class IntakeAnswer < ApplicationRecord
  belongs_to :fellow
  belongs_to :intake_question
  belongs_to :answered_by, class_name: "User", optional: true

  # Multi-select answers are stored as JSON arrays.
  def values = intake_question.kind == "multi_select" ? (JSON.parse(value.presence || "[]") rescue []) : [ value ]
  def display_value = values.compact_blank.join(", ")
end
