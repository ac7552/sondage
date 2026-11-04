# The Fellow chooses which family helpers may open the recordings after their death.
class Api::V1::HeirsController < Api::V1::BaseController
  before_action :require_fellow!

  def update
    ids = Array(params[:heir_contact_ids]).map(&:to_i)
    family = @fellow.safety_contacts.where(role: "family")
    ActiveRecord::Base.transaction do
      family.each { |c| c.update!(heir: ids.include?(c.id)) }
    end
    AuditEvent.record!("fellow.heirs_chosen", actor: current_user, fellow: @fellow, heirs: @fellow.heirs.pluck(:name))
    render json: { heirs: @fellow.heirs.map { |c| { id: c.id, name: c.name } } }
  end
end
