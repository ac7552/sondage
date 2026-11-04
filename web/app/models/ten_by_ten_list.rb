class TenByTenList < ApplicationRecord
  CATEGORIES = [
    [ "events", "10 most memorable events", "The moments that come back to you most often." ],
    [ "photos", "10 significant photographs", "Pictures you would save in a fire." ],
    [ "places", "10 places to show", "Homes, streets, churches, kitchens, landscapes." ],
    [ "people", "10 people who shaped you", "Family, friends, teachers, rivals." ],
    [ "songs", "10 songs of your life", "Music that takes you somewhere at once." ],
    [ "objects", "10 objects you've kept", "Things in drawers and on shelves, and why they stayed." ],
    [ "turning_points", "10 turning points", "Decisions, accidents and arrivals that changed the path." ],
    [ "work", "10 pieces of work", "Jobs, crafts, projects, things you made." ],
    [ "traditions", "10 traditions", "What your family does, eats, says and celebrates." ],
    [ "lessons", "10 things to pass on", "What you want the people after you to know." ]
  ].freeze

  belongs_to :fellow
  has_many :entries, -> { order(:rank) }, class_name: "TenByTenEntry", dependent: :destroy
  validates :category, :title, presence: true

  def entry(rank) = entries.detect { |e| e.rank == rank } || entries.build(rank:)
  def filled_count = entries.count { |e| e.title.present? }
end
