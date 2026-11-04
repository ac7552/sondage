class TenByTenEntry < ApplicationRecord
  belongs_to :ten_by_ten_list
  belongs_to :event, optional: true
  belongs_to :item, optional: true
  validates :rank, inclusion: { in: 1..10 }
end
